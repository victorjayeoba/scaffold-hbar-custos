// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IHRC719 } from "./interfaces/IHRC719.sol";

interface ICustosMarket {
    function requiredLiquidity() external view returns (uint256);
}

/**
 * @title LiquidityPool
 * @notice USDC in, cUSDC-LP shares out (ERC-4626). The pool is every trader's counterparty: it takes fees,
 *         liquidated collateral, net funding and trader losses, and pays trader profits.
 * @dev Withdrawals stop at what open positions need (`market.requiredLiquidity()`).
 */
contract LiquidityPool is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    error LiquidityPool__OnlyMarket();
    error LiquidityPool__MarketAlreadySet();
    error LiquidityPool__InvalidAddress();
    error LiquidityPool__ExceedsFreeAssets(uint256 free);

    address public market;

    event MarketSet(address indexed market);
    event TraderPaid(address indexed trader, uint256 amount);
    event Associated(bool ok, uint256 responseCode);
    event KeeperPaid(uint256 amount);

    constructor(IERC20 usdc, address owner_) ERC20("Custos LP USDC", "cUSDC-LP") ERC4626(usdc) Ownable(owner_) { }

    /// @notice One-time link to the market that may draw on the pool.
    function setMarket(address market_) external onlyOwner {
        if (market != address(0)) revert LiquidityPool__MarketAlreadySet();
        if (market_ == address(0)) revert LiquidityPool__InvalidAddress();
        market = market_;
        emit MarketSet(market_);
    }

    /// @notice Associates the pool with its HTS asset (HIP-719). Needed once on Hedera before it can hold USDC.
    function associate() external returns (bool ok) {
        uint256 rc;
        (ok, rc) = _associate();
        emit Associated(ok, rc);
    }

    /// @notice Pays a trader's profit. Only the market.
    function payTrader(address to, uint256 amount) external {
        if (msg.sender != market) revert LiquidityPool__OnlyMarket();
        IERC20(asset()).safeTransfer(to, amount);
        emit TraderPaid(to, amount);
    }

    /// @notice Pays the market's keeper, which swaps it to HBAR for its scheduled runs. Only the market, and only
    ///         from assets no open position needs: the network that guards the pool is paid by the pool.
    function payKeeper(uint256 amount) external {
        if (msg.sender != market) revert LiquidityPool__OnlyMarket();
        uint256 free = freeAssets();
        if (amount > free) revert LiquidityPool__ExceedsFreeAssets(free);
        IERC20(asset()).safeTransfer(market, amount);
        emit KeeperPaid(amount);
    }

    /// @notice USDC open positions need the pool to keep.
    function requiredLiquidity() public view returns (uint256) {
        return market == address(0) ? 0 : ICustosMarket(market).requiredLiquidity();
    }

    /// @notice USDC LPs can take out right now.
    function freeAssets() public view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 required = requiredLiquidity();
        return assets > required ? assets - required : 0;
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner_), freeAssets());
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        return Math.min(super.maxRedeem(owner_), _convertToShares(freeAssets(), Math.Rounding.Floor));
    }

    /// @dev Virtual shares make the first-depositor inflation attack uneconomic.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function _associate() internal returns (bool ok, uint256 rc) {
        bytes memory ret;
        (ok, ret) = asset().call(abi.encodeCall(IHRC719.associate, ()));
        if (ok && ret.length >= 32) rc = abi.decode(ret, (uint256));
    }
}
