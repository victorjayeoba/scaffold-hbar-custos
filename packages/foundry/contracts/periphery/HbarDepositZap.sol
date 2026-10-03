// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { PriceGuard } from "../PriceGuard.sol";
import { LiquidityPool } from "../LiquidityPool.sol";
import { IHRC719 } from "../interfaces/IHRC719.sol";
import { ISaucerSwapRouter } from "../interfaces/ISaucerSwapRouter.sol";

/**
 * @title HbarDepositZap
 * @notice Become an LP with HBAR alone: SaucerSwap swaps the HBAR to USDC, and the zap deposits that USDC into the
 *         LiquidityPool with the caller as receiver, so the cUSDC-LP shares land in the caller's account in one
 *         transaction. With `PerpMarket.openWithHbar` and `closeToHbar` on the trader side, SaucerSwap carries HBAR
 *         into and out of both sides of the market.
 * @dev A periphery contract: it holds nothing between calls and needs no rights on the pool (it deposits like any LP).
 *      The swap must return at least `maxSwapDeviationBps` short of the oracle value of the HBAR (and at least the
 *      caller's own minimum), so a pushed or thin SaucerSwap pool can't short-change the LP. The receiver must be
 *      associated with the share token, as for any deposit.
 */
contract HbarDepositZap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error HbarDepositZap__InvalidAddress();
    error HbarDepositZap__InvalidConfig();
    error HbarDepositZap__ZeroAmount();

    uint256 internal constant BPS = 10_000;

    LiquidityPool public immutable pool;
    PriceGuard public immutable guard;
    ISaucerSwapRouter public immutable router;
    IERC20 public immutable usdc;
    /// @notice The WHBAR token SaucerSwap paths start with.
    address public immutable whbar;
    /// @notice How far below the oracle value the swap may fill, in basis points.
    uint256 public immutable maxSwapDeviationBps;

    event DepositedWithHbar(address indexed lp, uint256 hbarIn, uint256 usdcOut, uint256 shares);
    event Associated(bool ok, uint256 responseCode);

    /// @param pool_ the LiquidityPool to deposit into (its asset is the USDC the swap buys)
    /// @param guard_ the PriceGuard whose price sets the swap's floor
    /// @param router_ SaucerSwap V1 router
    /// @param whbar_ WHBAR token
    /// @param maxSwapDeviationBps_ swap floor below the oracle value, basis points (< 10,000)
    constructor(address pool_, address guard_, address router_, address whbar_, uint256 maxSwapDeviationBps_) {
        if (pool_ == address(0) || guard_ == address(0) || router_ == address(0) || whbar_ == address(0)) {
            revert HbarDepositZap__InvalidAddress();
        }
        if (maxSwapDeviationBps_ >= BPS) revert HbarDepositZap__InvalidConfig();
        pool = LiquidityPool(pool_);
        guard = PriceGuard(guard_);
        router = ISaucerSwapRouter(router_);
        usdc = IERC20(LiquidityPool(pool_).asset());
        whbar = whbar_;
        maxSwapDeviationBps = maxSwapDeviationBps_;
    }

    /// @notice Swaps `msg.value` HBAR to USDC on SaucerSwap and deposits it into the pool for the caller.
    /// @param minUsdc the least USDC the swap may return (quote with `quote`, minus your slippage); the oracle floor
    ///        applies on top
    /// @return shares cUSDC-LP shares sent to the caller
    function depositWithHbar(uint256 minUsdc) external payable nonReentrant returns (uint256 shares) {
        if (msg.value == 0) revert HbarDepositZap__ZeroAmount();
        uint256 floor = oracleFloor(msg.value);
        if (floor > minUsdc) minUsdc = floor;

        address[] memory path = new address[](2);
        path[0] = whbar;
        path[1] = address(usdc);
        uint256 usdcOut =
            router.swapExactETHForTokens{ value: msg.value }(minUsdc, path, address(this), block.timestamp)[1];

        usdc.forceApprove(address(pool), usdcOut);
        shares = pool.deposit(usdcOut, msg.sender);
        emit DepositedWithHbar(msg.sender, msg.value, usdcOut, shares);
    }

    /// @notice USDC SaucerSwap would give for `hbar` (tinybars) right now.
    function quote(uint256 hbar) external view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = whbar;
        path[1] = address(usdc);
        return router.getAmountsOut(hbar, path)[1];
    }

    /// @notice The least USDC the swap of `hbar` (tinybars) may return: its oracle value less `maxSwapDeviationBps`.
    ///         Reverts unless the price is `Ok`.
    function oracleFloor(uint256 hbar) public view returns (uint256) {
        // tinybars × (USD per HBAR, 1e18) → USDC (6 dp): hbar × price / 1e20
        return hbar * guard.price() * (BPS - maxSwapDeviationBps) / (1e20 * BPS);
    }

    /// @notice Associates the zap with USDC (HIP-719). Needed once on Hedera before the swap can pay it.
    function associate() external returns (bool ok) {
        bytes memory ret;
        uint256 rc = 0;
        (ok, ret) = address(usdc).call(abi.encodeCall(IHRC719.associate, ()));
        if (ok && ret.length >= 32) rc = abi.decode(ret, (uint256));
        emit Associated(ok, rc);
    }
}
