// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { CustosBase } from "./CustosBase.sol";
import { LiquidityPool } from "../contracts/LiquidityPool.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract LiquidityPoolTest is CustosBase {
    function test_depositMintsSharesAtPoolValue() public {
        assertEq(pool.totalAssets(), POOL_SEED);
        assertEq(pool.balanceOf(lp), POOL_SEED * 1e6); // 6-decimal offset
        assertEq(pool.decimals(), 12);

        // fees raise the share price: a later depositor gets fewer shares per USDC
        _open(alice, true, 100e6, 10); // 1 USDC fee to the pool
        _fund(bob, 1_001e6);
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        uint256 shares = pool.deposit(1_000e6, bob);
        vm.stopPrank();
        assertLt(shares, 1_000e6 * 1e6);
        assertApproxEqAbs(pool.previewRedeem(shares), 1_000e6, 1);
    }

    function test_withdrawBlockedBelowRequiredLiquidity() public {
        _open(alice, true, 100e6, 10); // 1,000 open → pool must keep 2,000
        assertEq(pool.requiredLiquidity(), 2_000e6);
        assertEq(pool.freeAssets(), POOL_SEED + 1e6 - 2_000e6);
        assertEq(pool.maxWithdraw(lp), POOL_SEED + 1e6 - 2_000e6 - 1); // rounding in the pool's favour

        vm.prank(lp);
        vm.expectRevert();
        pool.withdraw(9_000e6, lp, lp);

        uint256 max = pool.maxWithdraw(lp);
        vm.prank(lp);
        pool.withdraw(max, lp, lp);
        assertGe(pool.totalAssets(), pool.requiredLiquidity());

        uint256 maxShares = pool.maxRedeem(lp);
        assertLe(pool.previewRedeem(maxShares), pool.freeAssets());
    }

    function test_redeemAllWhenNoPositions() public {
        uint256 shares = pool.balanceOf(lp);
        vm.prank(lp);
        pool.redeem(shares, lp, lp);
        assertApproxEqAbs(usdc.balanceOf(lp), POOL_SEED, 1);
    }

    function test_onlyMarketPaysTraders() public {
        vm.expectRevert(LiquidityPool.LiquidityPool__OnlyMarket.selector);
        pool.payTrader(alice, 1e6);

        vm.prank(address(market));
        pool.payTrader(alice, 1e6);
        assertEq(usdc.balanceOf(alice), 1_001e6);
    }

    function test_setMarketOnce() public {
        vm.expectRevert(LiquidityPool.LiquidityPool__MarketAlreadySet.selector);
        pool.setMarket(address(1));

        LiquidityPool fresh = new LiquidityPool(usdc, address(this));
        vm.expectRevert(LiquidityPool.LiquidityPool__InvalidAddress.selector);
        fresh.setMarket(address(0));
        vm.prank(alice);
        vm.expectRevert();
        fresh.setMarket(address(market));
        assertEq(fresh.requiredLiquidity(), 0);
    }

    function test_inflationAttackUneconomic() public {
        LiquidityPool fresh = new LiquidityPool(usdc, address(this));
        _fund(bob, 0);
        usdc.mint(bob, 10_001e6);
        vm.startPrank(bob);
        usdc.approve(address(fresh), type(uint256).max);
        fresh.deposit(1, bob);
        usdc.transfer(address(fresh), 10_000e6); // donation to inflate the share price
        vm.stopPrank();

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(fresh), type(uint256).max);
        uint256 shares = fresh.deposit(1_000e6, alice);
        vm.stopPrank();
        assertGt(shares, 0);
        assertApproxEqRel(fresh.previewRedeem(shares), 1_000e6, 1e15); // alice keeps ~all of it
    }

    function test_associateDoesNotRevertOffHedera() public {
        assertFalse(pool.associate());
    }

    function test_erc4626Interface() public view {
        assertEq(ERC4626(address(pool)).asset(), address(usdc));
        assertEq(pool.symbol(), "cUSDC-LP");
    }
}
