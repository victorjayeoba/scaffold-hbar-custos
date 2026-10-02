// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { MarginAccount } from "./MarginAccount.sol";
import { ScheduledKeeper } from "./ScheduledKeeper.sol";
import { PriceGuard } from "./PriceGuard.sol";
import { LiquidityPool } from "./LiquidityPool.sol";
import { IHRC719 } from "./interfaces/IHRC719.sol";
import { ISaucerSwapRouter } from "./interfaces/ISaucerSwapRouter.sol";

/**
 * @title PerpMarket
 * @notice HBAR-USD perpetual market settled in USDC, kept by the Hedera network: every `interval` the
 *         Schedule Service calls `tick()`, which accrues funding and liquidates underwater positions.
 *         Nothing is liquidated at a stale or deviated price. When prices are bad the market is close-only,
 *         and a close settles at whichever feed is worse for the trader.
 *         SaucerSwap does the HBAR conversions: open with HBAR alone (`openWithHbar`), close straight to HBAR
 *         (`closeToHbar`), and the keeper refuels its HBAR fee reserve from the pool's spare USDC.
 */
contract PerpMarket is MarginAccount, ScheduledKeeper, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error PerpMarket__InvalidAddress();
    error PerpMarket__InvalidConfig();
    error PerpMarket__ZeroAmount();
    error PerpMarket__InvalidLeverage();
    error PerpMarket__BelowMinCollateral(uint256 minCollateral);
    error PerpMarket__PositionExists();
    error PerpMarket__NoPosition();
    error PerpMarket__OpenInterestCap(uint256 cap);
    error PerpMarket__HoldTime(uint256 closeableAt);
    error PerpMarket__NoPrice();
    error PerpMarket__NotLiquidatable();
    error PerpMarket__SwapDisabled();
    error PerpMarket__OnlyKeeper();
    error PerpMarket__ReserveNotLow(uint256 runsLeft);
    error PerpMarket__NothingToSpend();

    uint256 public constant OPEN_FEE_BPS = 10;
    uint256 public constant CLOSE_FEE_BPS = 10;
    uint256 public constant LIQUIDATION_FEE_BPS = 50;
    uint256 public constant MIN_HOLD_SECONDS = 300;
    /// @notice Most positions one tick checks; the sweep resumes where it stopped on the next tick.
    uint256 public constant PAGE_SIZE = 50;
    /// @notice Open interest may use at most this share of the pool.
    uint256 public constant MAX_OPEN_INTEREST_BPS = 5_000;
    /// @notice The sweep stops early (and resumes next tick) when less gas than this is left.
    uint256 public constant SWEEP_GAS_PER_TRADER = 150_000;
    /// @notice The keeper refuels when its reserve covers fewer runs than this...
    uint256 public constant REFUEL_BELOW_RUNS = 12;
    /// @notice ...back up to this many runs...
    uint256 public constant REFUEL_TARGET_RUNS = 48;
    /// @notice ...spending at most this much of the pool's free USDC per refuel.
    uint256 public constant REFUEL_MAX_USDC = 50e6;
    /// @notice Slippage allowed against SaucerSwap's own quote when the keeper swaps.
    uint256 public constant REFUEL_SLIPPAGE_BPS = 100;

    IERC20 public immutable usdc;
    PriceGuard public immutable guard;
    LiquidityPool public immutable pool;
    /// @notice SaucerSwap V1 router (zero disables the HBAR paths).
    ISaucerSwapRouter public immutable router;
    /// @notice The WHBAR token SaucerSwap paths start or end with.
    address public immutable whbar;
    /// @notice Smallest collateral a position may open with, USDC. Stops dust positions from padding the sweep.
    uint256 public immutable minCollateral;
    /// @notice How far below the oracle price the keeper's refuel swap may fill, in basis points. The floor holds
    ///         even if SaucerSwap's pool is pushed around in the same block.
    uint256 public immutable maxSwapDeviationBps;

    /// @notice Where the next sweep starts in `traders`.
    uint256 public cursor;

    event Opened(
        address indexed trader,
        bool isLong,
        int256 size,
        uint256 collateral,
        uint256 price,
        uint256 leverage,
        uint256 fee
    );
    event Closed(address indexed trader, uint256 price, int256 pnl, int256 funding, uint256 payout, uint256 fee);
    event CollateralAdded(address indexed trader, uint256 amount);
    event Liquidated(address indexed trader, uint256 price, bool byNetwork, address indexed by, uint256 reward);
    event Swept(uint256 from, uint256 to, uint256 liquidated);
    event SweepSkipped(PriceGuard.Status status);
    event Associated(bool ok, uint256 responseCode);
    event SwappedHbarForCollateral(address indexed trader, uint256 hbarIn, uint256 usdcOut);
    event SwappedPayoutForHbar(address indexed trader, uint256 usdcIn, uint256 hbarOut);
    event Refueled(uint256 usdcIn, uint256 hbarOut, uint256 runsBefore);

    /// @param usdc_ collateral token (HTS USDC on Hedera)
    /// @param guard_ the PriceGuard every trade and tick reads
    /// @param pool_ the LiquidityPool that takes the other side of every trade
    /// @param owner_ may change `runCostEstimate` only; it cannot move funds
    /// @param interval_ seconds between network ticks
    /// @param gasLimit_ gas each scheduled tick is booked with; must exceed `SCHEDULE_GAS_RESERVE`
    /// @param runCostEstimate_ tinybars one tick costs, for `runsLeft()` and refuelling
    /// @param router_ SaucerSwap V1 router, or zero to disable the HBAR paths
    /// @param whbar_ WHBAR token, zero exactly when `router_` is zero
    /// @param minCollateral_ smallest collateral a position may open with, USDC
    /// @param maxSwapDeviationBps_ refuel floor below the oracle price, basis points (< 10,000)
    constructor(
        address usdc_,
        address guard_,
        address pool_,
        address owner_,
        uint256 interval_,
        uint256 gasLimit_,
        uint256 runCostEstimate_,
        address router_,
        address whbar_,
        uint256 minCollateral_,
        uint256 maxSwapDeviationBps_
    ) ScheduledKeeper(interval_, gasLimit_, runCostEstimate_) Ownable(owner_) {
        if (usdc_ == address(0) || guard_ == address(0) || pool_ == address(0)) {
            revert PerpMarket__InvalidAddress();
        }
        if ((router_ == address(0)) != (whbar_ == address(0))) revert PerpMarket__InvalidAddress();
        if (minCollateral_ == 0 || maxSwapDeviationBps_ >= BPS) revert PerpMarket__InvalidConfig();
        usdc = IERC20(usdc_);
        guard = PriceGuard(guard_);
        pool = LiquidityPool(pool_);
        router = ISaucerSwapRouter(router_);
        whbar = whbar_;
        minCollateral = minCollateral_;
        maxSwapDeviationBps = maxSwapDeviationBps_;
    }

    /*//////////////////////////////////////////////////////////////
                               TRADING
    //////////////////////////////////////////////////////////////*/

    /// @notice Opens a position of `collateral × leverage` USDC notional. Needs an `Ok` price.
    /// @param isLong true for long, false for short
    /// @param collateral USDC (6 dp) pulled from the caller; the open fee is taken from it
    /// @param leverage 1 to `MAX_LEVERAGE`
    function open(bool isLong, uint256 collateral, uint256 leverage) external nonReentrant {
        if (collateral == 0) revert PerpMarket__ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), collateral);
        _open(msg.sender, isLong, collateral, leverage);
    }

    /// @notice Opens a position with HBAR alone: SaucerSwap swaps `msg.value` to USDC collateral first.
    /// @param isLong true for long, false for short
    /// @param leverage 1 to `MAX_LEVERAGE`
    /// @param minCollateral_ the least USDC the swap may return (quote with `quoteHbarToUsdc`, minus slippage)
    function openWithHbar(bool isLong, uint256 leverage, uint256 minCollateral_) external payable nonReentrant {
        if (msg.value == 0) revert PerpMarket__ZeroAmount();
        if (address(router) == address(0)) revert PerpMarket__SwapDisabled();
        uint256 collateral = router.swapExactETHForTokens{ value: msg.value }(
            minCollateral_, _path(whbar, address(usdc)), address(this), block.timestamp
        )[1];
        emit SwappedHbarForCollateral(msg.sender, msg.value, collateral);
        _open(msg.sender, isLong, collateral, leverage);
    }

    /// @notice Closes the caller's position after `MIN_HOLD_SECONDS` and pays out USDC. Works in close-only mode
    ///         too: at an `Ok` price it settles at Chainlink; otherwise at whichever feed is worse for the trader.
    function close() external nonReentrant {
        (uint256 payout, uint256 collateral) = _close(msg.sender);
        _settle(msg.sender, collateral, payout);
    }

    /// @notice Closes like `close()`, then SaucerSwap swaps the USDC payout to HBAR for the caller.
    /// @param minHbarOut the least HBAR (tinybars) the swap may return (quote with `quoteUsdcToHbar`)
    /// @return hbarOut tinybars sent to the caller (0 if there was no payout)
    function closeToHbar(uint256 minHbarOut) external nonReentrant returns (uint256 hbarOut) {
        if (address(router) == address(0)) revert PerpMarket__SwapDisabled();
        (uint256 payout, uint256 collateral) = _close(msg.sender);
        _settle(address(this), collateral, payout);
        if (payout == 0) return 0;
        usdc.forceApprove(address(router), payout);
        hbarOut = router.swapExactTokensForETH(
            payout, minHbarOut, _path(address(usdc), whbar), msg.sender, block.timestamp
        )[1];
        emit SwappedPayoutForHbar(msg.sender, payout, hbarOut);
    }

    /// @notice Adds USDC collateral to the caller's open position, moving its liquidation price away.
    function addCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert PerpMarket__ZeroAmount();
        if (_positions[msg.sender].size == 0) revert PerpMarket__NoPosition();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _addCollateral(msg.sender, amount);
        emit CollateralAdded(msg.sender, amount);
    }

    /// @notice Anyone can liquidate an underwater position at an `Ok` price and earn `LIQUIDATION_FEE_BPS`.
    function liquidate(address trader) external nonReentrant {
        uint256 price = guard.price();
        _accrueFunding();
        if (!isLiquidatable(trader, price)) revert PerpMarket__NotLiquidatable();
        _liquidate(trader, price, msg.sender);
    }

    /// @notice Brings funding up to date. The pool calls this before every deposit and withdrawal so funding
    ///         is always measured against the assets that were really there. Anyone may call it.
    function accrueFunding() external {
        _accrueFunding();
    }

    /// @notice Tops up the keeper's HBAR reserve when it covers fewer than `REFUEL_BELOW_RUNS` runs: the pool pays
    ///         USDC it doesn't need for open positions, and SaucerSwap swaps it to HBAR. Only the keeper's own
    ///         tick calls this (as a self-call, so a failed swap can't undo the sweep).
    /// @return hbarOut tinybars added to the reserve
    function refuel() external returns (uint256 hbarOut) {
        if (msg.sender != address(this)) revert PerpMarket__OnlyKeeper();
        if (address(router) == address(0) || runCostEstimate == 0) revert PerpMarket__SwapDisabled();
        uint256 runs = address(this).balance / runCostEstimate;
        if (runs >= REFUEL_BELOW_RUNS) revert PerpMarket__ReserveNotLow(runs);
        uint256 price = guard.price(); // the floor below needs a price both feeds agree on

        address[] memory path = _path(address(usdc), whbar);
        uint256 usdcIn = router.getAmountsIn((REFUEL_TARGET_RUNS - runs) * runCostEstimate, path)[0];
        uint256 free = pool.freeAssets();
        if (usdcIn > free) usdcIn = free;
        if (usdcIn > REFUEL_MAX_USDC) usdcIn = REFUEL_MAX_USDC;
        if (usdcIn == 0) revert PerpMarket__NothingToSpend();

        uint256 minOut = router.getAmountsOut(usdcIn, path)[1] * (BPS - REFUEL_SLIPPAGE_BPS) / BPS;
        uint256 oracleFloor = _usdcToTinybars(usdcIn, price) * (BPS - maxSwapDeviationBps) / BPS;
        if (oracleFloor > minOut) minOut = oracleFloor;

        pool.payKeeper(usdcIn);
        usdc.forceApprove(address(router), usdcIn);
        hbarOut = router.swapExactTokensForETH(usdcIn, minOut, path, address(this), block.timestamp)[1];
        emit Refueled(usdcIn, hbarOut, runs);
    }

    /// @notice Associates the market with USDC (HIP-719). Needed once on Hedera to hold collateral.
    function associate() external returns (bool ok) {
        bytes memory ret;
        uint256 rc;
        (ok, ret) = address(usdc).call(abi.encodeCall(IHRC719.associate, ()));
        if (ok && ret.length >= 32) rc = abi.decode(ret, (uint256));
        emit Associated(ok, rc);
    }

    /// @notice Updates the tinybars one tick is assumed to cost (for `runsLeft()` and refuelling).
    function setRunCostEstimate(uint256 tinybars) external onlyOwner {
        _setRunCostEstimate(tinybars);
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice USDC SaucerSwap would give for `hbar` (tinybars on Hedera) right now.
    function quoteHbarToUsdc(uint256 hbar) external view returns (uint256) {
        if (address(router) == address(0)) revert PerpMarket__SwapDisabled();
        return router.getAmountsOut(hbar, _path(whbar, address(usdc)))[1];
    }

    /// @notice HBAR (tinybars) SaucerSwap would give for `usdcAmount` right now.
    function quoteUsdcToHbar(uint256 usdcAmount) external view returns (uint256) {
        if (address(router) == address(0)) revert PerpMarket__SwapDisabled();
        return router.getAmountsOut(usdcAmount, _path(address(usdc), whbar))[1];
    }

    /// @notice USDC the pool must keep for open positions (withdrawals stop here).
    function requiredLiquidity() external view returns (uint256) {
        return totalOpenNotional() * BPS / MAX_OPEN_INTEREST_BPS;
    }

    /// @notice What traders together have gained (+) or lost (−) on open positions, net of funding, for the pool
    ///         to book against its assets. `ok` is false when there are open positions but no `Ok` price, in which
    ///         case the pool refuses deposits and withdrawals rather than price shares at a bad price.
    function traderGainForPool() external view returns (int256 gain, bool ok) {
        if (traders.length == 0) return (0, true);
        (uint256 price, PriceGuard.Status status,,,) = guard.read();
        if (status != PriceGuard.Status.Ok) return (0, false);
        return (netTraderGain(price), true);
    }

    /// @notice The price a close by `trader` would settle at right now (0 if neither feed answers).
    function closePrice(address trader) public view returns (uint256) {
        (uint256 chainlinkPrice, uint256 supraPrice, PriceGuard.Status status) = guard.prices();
        if (status == PriceGuard.Status.Ok) return chainlinkPrice;
        if (chainlinkPrice == 0) return supraPrice;
        if (supraPrice == 0) return chainlinkPrice;
        bool worseIsLower = _positions[trader].size > 0; // a long is hurt by the lower price, a short by the higher
        if (worseIsLower) return chainlinkPrice < supraPrice ? chainlinkPrice : supraPrice;
        return chainlinkPrice > supraPrice ? chainlinkPrice : supraPrice;
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Collateral is already in the market.
    function _open(address trader, bool isLong, uint256 collateral, uint256 leverage) internal {
        if (collateral < minCollateral) revert PerpMarket__BelowMinCollateral(minCollateral);
        if (leverage == 0 || leverage > MAX_LEVERAGE) revert PerpMarket__InvalidLeverage();
        if (_positions[trader].size != 0) revert PerpMarket__PositionExists();

        uint256 price = guard.price();
        _accrueFunding();

        uint256 notional = collateral * leverage;
        uint256 cap = usdc.balanceOf(address(pool)) * MAX_OPEN_INTEREST_BPS / BPS;
        if (totalOpenNotional() + notional > cap) revert PerpMarket__OpenInterestCap(cap);

        uint256 fee = notional * OPEN_FEE_BPS / BPS;
        if (fee >= collateral) revert PerpMarket__InvalidLeverage();
        int256 size = int256(notional * USDC_PER_SIZE_PRICE / price);
        if (!isLong) size = -size;

        usdc.safeTransfer(address(pool), fee);
        _addPosition(trader, size, collateral - fee, price, notional);

        emit Opened(trader, isLong, size, collateral - fee, price, leverage, fee);
    }

    /// @dev Removes the position and returns what the trader is owed and the collateral that was held for it.
    function _close(address trader) internal returns (uint256 payout, uint256 collateral) {
        Position storage p = _positions[trader];
        if (p.size == 0) revert PerpMarket__NoPosition();
        uint256 closeableAt = p.openedAt + MIN_HOLD_SECONDS;
        if (block.timestamp < closeableAt) revert PerpMarket__HoldTime(closeableAt);

        uint256 price = closePrice(trader);
        if (price == 0) revert PerpMarket__NoPrice();
        _accrueFunding();

        int256 positionPnl = pnl(trader, price);
        int256 funding = fundingOwed(trader);
        int256 eq = equity(trader, price);
        uint256 fee = p.entryNotional * CLOSE_FEE_BPS / BPS;
        payout = eq > int256(fee) ? uint256(eq) - fee : 0;
        collateral = p.collateral;

        _removePosition(trader);
        emit Closed(trader, price, positionPnl, funding, payout, fee);
    }

    /// @dev Every tick: accrue funding, sweep one page of traders if the price is `Ok`, refuel if running low.
    function _work() internal override {
        _accrueFunding();
        (uint256 price, PriceGuard.Status status,,,) = guard.read();
        if (status == PriceGuard.Status.Ok) _sweep(price);
        else emit SweepSkipped(status);

        if (address(router) != address(0) && runCostEstimate > 0) {
            if (address(this).balance / runCostEstimate < REFUEL_BELOW_RUNS) {
                try this.refuel() { } catch { } // a failed refuel must never undo the sweep
            }
        }
    }

    function _sweep(uint256 price) internal {
        uint256 from = cursor;
        uint256 i = from < traders.length ? from : 0;
        uint256 checked;
        uint256 liquidated;
        while (checked < PAGE_SIZE && i < traders.length && gasleft() > SWEEP_GAS_PER_TRADER) {
            address trader = traders[i];
            checked++;
            if (isLiquidatable(trader, price)) {
                _liquidate(trader, price, address(0)); // swaps the last trader into slot i
                liquidated++;
            } else {
                i++;
            }
        }
        cursor = i >= traders.length ? 0 : i;
        emit Swept(from, i, liquidated);
    }

    /// @dev `by == address(0)` means the network did it (only `tick()` passes zero): no reward, all collateral to
    ///      the pool.
    function _liquidate(address trader, uint256 price, address by) internal {
        Position storage p = _positions[trader];
        uint256 collateral = p.collateral;
        uint256 reward;
        if (by != address(0)) {
            reward = p.entryNotional * LIQUIDATION_FEE_BPS / BPS;
            if (reward > collateral) reward = collateral;
        }
        _removePosition(trader);
        if (reward > 0) usdc.safeTransfer(by, reward);
        if (collateral > reward) usdc.safeTransfer(address(pool), collateral - reward);
        emit Liquidated(trader, price, by == address(0), by, reward);
    }

    /// @dev The market holds collateral; the pool covers anything above it and takes anything below.
    ///      `to` is the trader, or the market itself when the payout is swapped to HBAR next.
    function _settle(address to, uint256 collateral, uint256 payout) internal {
        if (payout >= collateral) {
            if (to != address(this)) usdc.safeTransfer(to, collateral);
            if (payout > collateral) pool.payTrader(to, payout - collateral);
        } else {
            if (payout > 0 && to != address(this)) usdc.safeTransfer(to, payout);
            usdc.safeTransfer(address(pool), collateral - payout);
        }
    }

    /// @dev USDC (6 dp) to tinybars at `price` (1e18 USD per HBAR): usdc × 1e12 / price HBAR, × 1e8 tinybars.
    function _usdcToTinybars(uint256 usdcAmount, uint256 price) internal pure returns (uint256) {
        return usdcAmount * 1e20 / price;
    }

    function _path(address from, address to) internal pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = from;
        path[1] = to;
    }

    function _fundingPoolAssets() internal view override returns (uint256) {
        return usdc.balanceOf(address(pool));
    }
}
