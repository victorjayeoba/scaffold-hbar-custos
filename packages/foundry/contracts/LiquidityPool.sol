// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IHederaTokenService } from "hedera-forking/IHederaTokenService.sol";
import { HederaResponseCodes } from "hedera-forking/HederaResponseCodes.sol";
import { IHRC719 } from "./interfaces/IHRC719.sol";

/// @notice What the pool needs from the market it backs.
interface ICustosMarket {
    function requiredLiquidity() external view returns (uint256);
    function traderGainForPool() external view returns (int256 gain, bool ok);
    function accrueFunding() external;
}

/**
 * @title LiquidityPool
 * @notice USDC in, cUSDC-LP shares out. The shares are a native Hedera (HTS) token that this contract creates and
 *         mints, so they show up in any Hedera wallet and on HashScan like any other token. The pool is every
 *         trader's counterparty: it takes fees, liquidated collateral, net funding and trader losses, and pays
 *         trader profits.
 * @dev Shares are priced at what the pool is really worth: its USDC minus what traders are up on open positions
 *      (or plus what they are down). Without that, anyone could deposit just before a loss or liquidation lands in
 *      the pool and withdraw just after, taking most of it. Funding is accrued before every deposit and withdrawal.
 *      Withdrawals stop at what open positions need (`market.requiredLiquidity()`).
 *      To receive shares an account must be associated with the share token (or have a free auto-association slot).
 *      To redeem, approve the pool on the share token first.
 */
contract LiquidityPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error LiquidityPool__OnlyMarket();
    error LiquidityPool__MarketAlreadySet();
    error LiquidityPool__InvalidAddress();
    error LiquidityPool__ExceedsFreeAssets(uint256 free);
    error LiquidityPool__ShareTokenExists();
    error LiquidityPool__NoShareToken();
    error LiquidityPool__HtsFailed(int64 responseCode);
    error LiquidityPool__NoPrice();
    error LiquidityPool__ZeroAmount();
    error LiquidityPool__TooFewShares(uint256 shares);
    error LiquidityPool__ExceedsMax(uint256 max);
    error LiquidityPool__RefundFailed();

    IHederaTokenService internal constant HTS = IHederaTokenService(address(0x167));
    int64 internal constant HTS_SUCCESS = int64(int32(HederaResponseCodes.SUCCESS));
    /// @notice Share decimals: one share starts out worth one micro-USDC.
    int32 public constant SHARE_DECIMALS = 6;
    /// @notice Shares minted to the pool itself on the first deposit and never redeemable, so the share price
    ///         can't be inflated by a donation into an empty pool.
    uint256 public constant DEAD_SHARES = 1_000;
    /// @notice How often the share token's renewal fee is charged to the pool (90 days, the HTS default).
    int64 public constant SHARE_AUTO_RENEW_PERIOD = 7_776_000;

    IERC20 internal immutable _asset;
    /// @notice The cUSDC-LP HTS token. Zero until `createShareToken()`.
    address public shareToken;
    /// @notice The market that may draw on the pool.
    address public market;

    event MarketSet(address indexed market);
    event ShareTokenCreated(address indexed token);
    event Deposit(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);
    event TraderPaid(address indexed trader, uint256 amount);
    event KeeperPaid(uint256 amount);
    event Associated(bool ok, uint256 responseCode);

    /// @param usdc the pool's asset (HTS USDC on Hedera)
    /// @param owner_ may link the market and create the share token, once each; it cannot move funds
    constructor(IERC20 usdc, address owner_) Ownable(owner_) {
        if (address(usdc) == address(0)) revert LiquidityPool__InvalidAddress();
        _asset = usdc;
    }

    /*//////////////////////////////////////////////////////////////
                                SETUP
    //////////////////////////////////////////////////////////////*/

    /// @notice One-time link to the market that may draw on the pool.
    function setMarket(address market_) external onlyOwner {
        if (market != address(0)) revert LiquidityPool__MarketAlreadySet();
        if (market_ == address(0)) revert LiquidityPool__InvalidAddress();
        market = market_;
        emit MarketSet(market_);
    }

    /// @notice Creates the cUSDC-LP share token on the Hedera Token Service, with the pool as treasury and as the
    ///         only supply key. `msg.value` pays HTS's token-creation fee; whatever is left is sent back.
    function createShareToken() external payable nonReentrant onlyOwner {
        if (shareToken != address(0)) revert LiquidityPool__ShareTokenExists();

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = IHederaTokenService.TokenKey({
            keyType: 16, // bit 4: supply key
            key: IHederaTokenService.KeyValue({
                inheritAccountKey: false,
                contractId: address(this),
                ed25519: "",
                ECDSA_secp256k1: "",
                delegatableContractId: address(0)
            })
        });
        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken({
            name: "Custos LP USDC",
            symbol: "cUSDC-LP",
            treasury: address(this),
            memo: "Custos liquidity pool shares",
            tokenSupplyType: false, // infinite
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: IHederaTokenService.Expiry({
                second: 0, autoRenewAccount: address(this), autoRenewPeriod: SHARE_AUTO_RENEW_PERIOD
            })
        });

        (int64 rc, address created) = HTS.createFungibleToken{ value: msg.value }(token, 0, SHARE_DECIMALS);
        if (rc != HTS_SUCCESS || created == address(0)) revert LiquidityPool__HtsFailed(rc);
        shareToken = created;
        emit ShareTokenCreated(created);

        uint256 left = address(this).balance;
        if (left > 0) {
            (bool ok,) = payable(msg.sender).call{ value: left }("");
            if (!ok) revert LiquidityPool__RefundFailed();
        }
    }

    /// @notice Associates the pool with its USDC (HIP-719). Needed once on Hedera before it can hold USDC.
    function associate() external returns (bool ok) {
        bytes memory ret;
        uint256 rc = 0;
        (ok, ret) = address(_asset).call(abi.encodeCall(IHRC719.associate, ()));
        if (ok && ret.length >= 32) rc = abi.decode(ret, (uint256));
        emit Associated(ok, rc);
    }

    /*//////////////////////////////////////////////////////////////
                              LP ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposits `assets` USDC and sends the minted shares to `receiver`.
    /// @dev The first deposit also mints `DEAD_SHARES` to the pool, so it must exceed that.
    /// @return shares sent to `receiver`
    function deposit(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert LiquidityPool__ZeroAmount();
        if (receiver == address(0)) revert LiquidityPool__InvalidAddress();
        address token = _requireShareToken();
        _syncMarket();

        uint256 supply = IERC20(token).totalSupply();
        shares = _toShares(assets, supply, Math.Rounding.Floor);
        uint256 minted = shares;
        if (supply == 0) {
            if (shares <= DEAD_SHARES) revert LiquidityPool__TooFewShares(shares);
            shares -= DEAD_SHARES;
        }
        if (shares == 0) revert LiquidityPool__TooFewShares(0);

        _asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(token, minted);
        _send(token, receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /// @notice Burns `shares` of the caller's and sends the USDC they are worth to `receiver`.
    /// @dev The caller must have approved the pool for `shares` on the share token.
    /// @return assets USDC sent to `receiver`
    function redeem(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert LiquidityPool__ZeroAmount();
        if (receiver == address(0)) revert LiquidityPool__InvalidAddress();
        address token = _requireShareToken();
        _syncMarket();

        uint256 max = maxRedeem(msg.sender);
        if (shares > max) revert LiquidityPool__ExceedsMax(max);
        assets = _toAssets(shares, IERC20(token).totalSupply(), Math.Rounding.Floor);
        if (assets == 0) revert LiquidityPool__ZeroAmount();
        _exit(token, receiver, assets, shares);
    }

    /// @notice Withdraws exactly `assets` USDC to `receiver`, burning the shares that costs the caller.
    /// @dev The caller must have approved the pool on the share token for at least `previewWithdraw(assets)`.
    /// @return shares burned
    function withdraw(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert LiquidityPool__ZeroAmount();
        if (receiver == address(0)) revert LiquidityPool__InvalidAddress();
        address token = _requireShareToken();
        _syncMarket();

        uint256 max = maxWithdraw(msg.sender);
        if (assets > max) revert LiquidityPool__ExceedsMax(max);
        shares = _toShares(assets, IERC20(token).totalSupply(), Math.Rounding.Ceil);
        _exit(token, receiver, assets, shares);
    }

    /*//////////////////////////////////////////////////////////////
                              MARKET ONLY
    //////////////////////////////////////////////////////////////*/

    /// @notice Pays a trader's profit. Only the market.
    function payTrader(address to, uint256 amount) external {
        if (msg.sender != market) revert LiquidityPool__OnlyMarket();
        _asset.safeTransfer(to, amount);
        emit TraderPaid(to, amount);
    }

    /// @notice Pays the market's keeper, which swaps it to HBAR for its scheduled runs. Only the market, and only
    ///         from assets no open position needs: the network that guards the pool is paid by the pool.
    function payKeeper(uint256 amount) external {
        if (msg.sender != market) revert LiquidityPool__OnlyMarket();
        uint256 free = freeAssets();
        if (amount > free) revert LiquidityPool__ExceedsFreeAssets(free);
        _asset.safeTransfer(market, amount);
        emit KeeperPaid(amount);
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice The USDC token the pool holds.
    function asset() external view returns (address) {
        return address(_asset);
    }

    /// @notice What the pool is worth in USDC: its balance minus traders' open gains (plus their open losses).
    ///         Falls back to the plain balance when there is no `Ok` price (deposits and withdrawals are closed then).
    function totalAssets() public view returns (uint256) {
        (uint256 value,) = _value();
        return value;
    }

    /// @notice Shares in existence, including the pool's `DEAD_SHARES`.
    function totalSupply() public view returns (uint256) {
        return shareToken == address(0) ? 0 : IERC20(shareToken).totalSupply();
    }

    /// @notice Shares `account` holds.
    function balanceOf(address account) public view returns (uint256) {
        return shareToken == address(0) ? 0 : IERC20(shareToken).balanceOf(account);
    }

    /// @notice Shares `assets` USDC buys now (rounded down).
    function convertToShares(uint256 assets) public view returns (uint256) {
        return _toShares(assets, totalSupply(), Math.Rounding.Floor);
    }

    /// @notice USDC `shares` are worth now (rounded down).
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _toAssets(shares, totalSupply(), Math.Rounding.Floor);
    }

    /// @notice Shares a deposit of `assets` would send to the receiver now (net of `DEAD_SHARES` on the first).
    function previewDeposit(uint256 assets) external view returns (uint256 shares) {
        uint256 supply = totalSupply();
        shares = _toShares(assets, supply, Math.Rounding.Floor);
        if (supply == 0) shares = shares > DEAD_SHARES ? shares - DEAD_SHARES : 0;
    }

    /// @notice USDC redeeming `shares` would pay now.
    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @notice Shares withdrawing `assets` would burn now (rounded up).
    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return _toShares(assets, totalSupply(), Math.Rounding.Ceil);
    }

    /// @notice USDC open positions need the pool to keep.
    function requiredLiquidity() public view returns (uint256) {
        return market == address(0) ? 0 : ICustosMarket(market).requiredLiquidity();
    }

    /// @notice USDC that can leave the pool right now (its balance above `requiredLiquidity()`).
    function freeAssets() public view returns (uint256) {
        uint256 balance = _asset.balanceOf(address(this));
        uint256 required = requiredLiquidity();
        return balance > required ? balance - required : 0;
    }

    /// @notice Most USDC `owner_` can withdraw now.
    function maxWithdraw(address owner_) public view returns (uint256) {
        return Math.min(convertToAssets(balanceOf(owner_)), freeAssets());
    }

    /// @notice Most shares `owner_` can redeem now.
    function maxRedeem(address owner_) public view returns (uint256) {
        return Math.min(balanceOf(owner_), convertToShares(freeAssets()));
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Accrues funding at the old balance, then refuses to price shares without an `Ok` price.
    function _syncMarket() internal {
        if (market == address(0)) return;
        ICustosMarket(market).accrueFunding();
        (, bool ok) = _value();
        if (!ok) revert LiquidityPool__NoPrice();
    }

    function _value() internal view returns (uint256 value, bool ok) {
        uint256 balance = _asset.balanceOf(address(this));
        if (market == address(0)) return (balance, true);
        int256 gain;
        (gain, ok) = ICustosMarket(market).traderGainForPool();
        int256 v = int256(balance) - gain;
        value = v > 0 ? uint256(v) : 0;
    }

    /// @dev Virtual share and asset of 1 (OpenZeppelin's ERC-4626 formula with a zero offset).
    function _toShares(uint256 assets, uint256 supply, Math.Rounding rounding) internal view returns (uint256) {
        return Math.mulDiv(assets, supply + 1, totalAssets() + 1, rounding);
    }

    function _toAssets(uint256 shares, uint256 supply, Math.Rounding rounding) internal view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + 1, supply + 1, rounding);
    }

    function _exit(address token, address receiver, uint256 assets, uint256 shares) internal {
        IERC20(token).safeTransferFrom(msg.sender, address(this), shares);
        _burn(token, shares);
        _asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, assets, shares);
    }

    function _mint(address token, uint256 amount) internal {
        (int64 rc,,) = HTS.mintToken(token, SafeCast.toInt64(SafeCast.toInt256(amount)), new bytes[](0));
        if (rc != HTS_SUCCESS) revert LiquidityPool__HtsFailed(rc);
    }

    function _burn(address token, uint256 amount) internal {
        (int64 rc,) = HTS.burnToken(token, SafeCast.toInt64(SafeCast.toInt256(amount)), new int64[](0));
        if (rc != HTS_SUCCESS) revert LiquidityPool__HtsFailed(rc);
    }

    /// @dev Shares are minted to the treasury (the pool), then sent on.
    function _send(address token, address to, uint256 amount) internal {
        int64 rc = HTS.transferToken(token, address(this), to, SafeCast.toInt64(SafeCast.toInt256(amount)));
        if (rc != HTS_SUCCESS) revert LiquidityPool__HtsFailed(rc);
    }

    function _requireShareToken() internal view returns (address token) {
        token = shareToken;
        if (token == address(0)) revert LiquidityPool__NoShareToken();
    }
}
