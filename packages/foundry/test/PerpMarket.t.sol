// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { CustosBase } from "./CustosBase.sol";
import { PerpMarket } from "../contracts/PerpMarket.sol";
import { MarginAccount } from "../contracts/MarginAccount.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";
import { LiquidityPool } from "../contracts/LiquidityPool.sol";

contract PerpMarketTest is CustosBase {
    /*//////////////////////////////////////////////////////////////
                                 OPEN
    //////////////////////////////////////////////////////////////*/

    function test_openLong() public {
        _open(alice, true, 100e6, 10);
        MarginAccount.Position memory p = market.positionOf(alice);
        assertEq(p.size, int256(uint256(1000e6) * 1e30 / 0.12e18));
        assertEq(p.collateral, 99e6); // 10 bps of 1,000 notional
        assertEq(p.entryPrice, 0.12e18);
        assertEq(p.entryNotional, 1000e6);
        assertEq(market.longNotional(), 1000e6);
        assertEq(usdc.balanceOf(address(pool)), POOL_SEED + 1e6);
        assertEq(usdc.balanceOf(address(market)), 99e6);
        assertEq(market.traderCount(), 1);
    }

    function test_openShortHasNegativeSize() public {
        _open(bob, false, 100e6, 5);
        assertLt(market.positionOf(bob).size, 0);
        assertEq(market.shortNotional(), 500e6);
    }

    function test_openRejectsBadInput() public {
        vm.startPrank(alice);
        vm.expectRevert(PerpMarket.PerpMarket__ZeroAmount.selector);
        market.open(true, 0, 10);
        vm.expectRevert(PerpMarket.PerpMarket__InvalidLeverage.selector);
        market.open(true, 10e6, 51);
        vm.expectRevert(PerpMarket.PerpMarket__InvalidLeverage.selector);
        market.open(true, 10e6, 0);
        market.open(true, 10e6, 50);
        vm.expectRevert(PerpMarket.PerpMarket__PositionExists.selector);
        market.open(true, 10e6, 2);
        vm.stopPrank();
    }

    function test_openInterestCap() public {
        // cap = 50% of 10,000 = 5,000 notional
        _fund(alice, 10_000e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpMarket.PerpMarket__OpenInterestCap.selector, 5_000e6));
        market.open(true, 501e6, 10);
    }

    function test_closeOnlyModeBlocksOpens() public {
        supra.set(12_500_000, block.timestamp); // 4.2% apart
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PriceGuard__NotOk.selector, PriceGuard.Status.Deviated));
        market.open(true, 10e6, 10);
    }

    /*//////////////////////////////////////////////////////////////
                                CLOSE
    //////////////////////////////////////////////////////////////*/

    function test_closeLongInProfitPaidByPool() public {
        _open(alice, true, 100e6, 10);
        vm.warp(block.timestamp + 300);
        _setPrice(13_200_000); // +10%

        int256 expected = market.equity(alice, 0.132e18) - int256(1e6); // close fee 10 bps
        uint256 poolBefore = usdc.balanceOf(address(pool));
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        market.close();

        assertEq(usdc.balanceOf(alice) - aliceBefore, uint256(expected));
        assertGt(uint256(expected), 99e6 + 98e6); // ~+100 PnL, minus funding and fee
        assertEq(poolBefore - usdc.balanceOf(address(pool)), uint256(expected) - 99e6);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(market.traderCount(), 0);
        assertEq(market.totalOpenNotional(), 0);
    }

    function test_closeShortAtLossPaysPool() public {
        _open(bob, false, 100e6, 5);
        vm.warp(block.timestamp + 300);
        _setPrice(12_600_000); // +5%, short loses ~25

        int256 expected = market.equity(bob, 0.126e18) - int256(0.5e6);
        uint256 poolBefore = usdc.balanceOf(address(pool));
        vm.prank(bob);
        market.close();

        assertEq(usdc.balanceOf(bob), 900e6 + uint256(expected));
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, 99.5e6 - uint256(expected));
        assertEq(usdc.balanceOf(address(market)), 0);
    }

    function test_closeRespectsMinHold() public {
        _open(alice, true, 100e6, 10);
        vm.warp(block.timestamp + 299);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpMarket.PerpMarket__HoldTime.selector, block.timestamp + 1));
        market.close();
    }

    function test_closeAllowedInCloseOnlyMode() public {
        _open(alice, true, 100e6, 10);
        vm.warp(block.timestamp + 300);
        supra.set(13_000_000, block.timestamp); // deviated
        chainlink.set(12_000_000, block.timestamp);
        assertEq(uint256(guard.status()), uint256(PriceGuard.Status.Deviated));
        vm.prank(alice);
        market.close();
        assertEq(market.positionOf(alice).size, 0);
    }

    function test_closeWithoutPositionReverts() public {
        vm.prank(alice);
        vm.expectRevert(PerpMarket.PerpMarket__NoPosition.selector);
        market.close();
    }

    function test_gainCappedAtNotional() public {
        _open(alice, true, 100e6, 2); // notional 200
        vm.warp(block.timestamp + 300);
        _setPrice(48_000_000); // 4x: raw PnL 600
        assertEq(market.equity(alice, 0.48e18), int256(99.8e6 + 200e6));
    }

    /*//////////////////////////////////////////////////////////////
                              COLLATERAL
    //////////////////////////////////////////////////////////////*/

    function test_addCollateral() public {
        _open(alice, true, 100e6, 10);
        vm.prank(alice);
        market.addCollateral(50e6);
        assertEq(market.positionOf(alice).collateral, 149e6);
        assertEq(usdc.balanceOf(address(market)), 149e6);

        vm.prank(bob);
        vm.expectRevert(PerpMarket.PerpMarket__NoPosition.selector);
        market.addCollateral(1e6);
    }

    /*//////////////////////////////////////////////////////////////
                             LIQUIDATION
    //////////////////////////////////////////////////////////////*/

    function test_liquidationPriceMatchesIsLiquidatable() public {
        _open(alice, true, 10e6, 50);
        uint256 liq = market.liquidationPrice(alice);
        assertApproxEqRel(liq, 0.11892e18, 1e14); // ~0.9% below entry
        assertFalse(market.isLiquidatable(alice, liq + 1e12));
        assertTrue(market.isLiquidatable(alice, liq - 1e12));

        _open(bob, false, 10e6, 50);
        uint256 liqShort = market.liquidationPrice(bob);
        assertGt(liqShort, 0.12e18);
        assertFalse(market.isLiquidatable(bob, liqShort - 1e12));
        assertTrue(market.isLiquidatable(bob, liqShort + 1e12));
    }

    function test_liquidateByAnyonePaysReward() public {
        _open(alice, true, 10e6, 50); // collateral 9.5, notional 500
        _setPrice(11_880_000); // -1%

        uint256 poolBefore = usdc.balanceOf(address(pool));
        vm.expectEmit(true, true, false, true, address(market));
        emit PerpMarket.Liquidated(alice, 0.1188e18, false, liquidator, 2.5e6);
        vm.prank(liquidator);
        market.liquidate(alice);

        assertEq(usdc.balanceOf(liquidator), 2.5e6); // 50 bps of 500
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, 7e6);
        assertEq(market.traderCount(), 0);
    }

    function test_liquidateHealthyReverts() public {
        _open(alice, true, 10e6, 50);
        vm.prank(liquidator);
        vm.expectRevert(PerpMarket.PerpMarket__NotLiquidatable.selector);
        market.liquidate(alice);
    }

    function test_noLiquidationOnStalePrice() public {
        _open(alice, true, 10e6, 50);
        vm.warp(block.timestamp + 3601);
        chainlink.set(11_000_000, block.timestamp - 3601); // underwater but stale
        supra.set(11_000_000, block.timestamp);
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PriceGuard__NotOk.selector, PriceGuard.Status.Stale));
        market.liquidate(alice);
    }

    /*//////////////////////////////////////////////////////////////
                           NETWORK KEEPER
    //////////////////////////////////////////////////////////////*/

    function test_tickLiquidatesByNetwork() public {
        _open(alice, true, 10e6, 50);
        _open(bob, true, 100e6, 2);
        market.revive();
        vm.warp(market.nextRunAt());
        _setPrice(11_880_000);

        uint256 poolBefore = usdc.balanceOf(address(pool));
        vm.expectEmit(true, true, false, true, address(market));
        emit PerpMarket.Liquidated(alice, 0.1188e18, true, address(0), 0);
        _tick();

        assertEq(market.positionOf(alice).size, 0);
        assertTrue(market.positionOf(bob).size != 0);
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, 9.5e6); // no reward: all collateral to the pool
        assertEq(market.nextRunAt(), block.timestamp + 300);
    }

    function test_tickSkipsSweepOnDeviatedPrice() public {
        _open(alice, true, 10e6, 50);
        market.revive();
        vm.warp(market.nextRunAt());
        chainlink.set(11_000_000, block.timestamp); // alice underwater on Chainlink
        supra.set(12_000_000, block.timestamp); // but Supra disagrees by 9%

        vm.expectEmit(false, false, false, true, address(market));
        emit PerpMarket.SweepSkipped(PriceGuard.Status.Deviated);
        _tick();
        assertTrue(market.positionOf(alice).size != 0);
        assertEq(market.nextRunAt(), block.timestamp + 300); // still rescheduled
    }

    function test_sweepPagesAndWraps() public {
        for (uint256 i = 0; i < 60; i++) {
            address t = address(uint160(0x1000 + i));
            _fund(t, 10e6);
            _open(t, true, 10e6, 2);
        }
        market.revive();
        vm.warp(market.nextRunAt());
        vm.expectEmit(false, false, false, true, address(market));
        emit PerpMarket.Swept(0, 50, 0);
        _tick();
        assertEq(market.cursor(), 50);

        vm.warp(market.nextRunAt());
        vm.expectEmit(false, false, false, true, address(market));
        emit PerpMarket.Swept(50, 60, 0);
        _tick();
        assertEq(market.cursor(), 0);
    }

    function test_sweepLiquidatesSwappedInTrader() public {
        // two underwater traders back to back: removing the first swaps the second into its slot
        _open(alice, true, 10e6, 50);
        _open(bob, true, 10e6, 50);
        market.revive();
        vm.warp(market.nextRunAt());
        _setPrice(11_880_000);
        _tick();
        assertEq(market.traderCount(), 0);
    }

    function test_lowGasTickStopsEarlyAndStillReschedules() public {
        for (uint256 i = 0; i < 20; i++) {
            address t = address(uint160(0x2000 + i));
            _fund(t, 10e6);
            _open(t, true, 10e6, 10);
        }
        market.revive();
        vm.warp(market.nextRunAt());
        _setPrice(10_000_000); // everyone underwater

        vm.prank(address(market));
        market.tick{ gas: 2_400_000 }();
        uint256 left = market.traderCount();
        assertGt(left, 0); // not all fit in this tick
        assertLt(left, 20); // but some were liquidated
        assertEq(market.nextRunAt(), block.timestamp + 300);

        vm.warp(market.nextRunAt());
        _setPrice(10_000_000);
        _tick();
        assertEq(market.traderCount(), 0);
    }

    /*//////////////////////////////////////////////////////////////
                               FUNDING
    //////////////////////////////////////////////////////////////*/

    function test_fundingHeavySidePays() public {
        _open(alice, true, 100e6, 10); // 1,000 long
        _open(bob, false, 100e6, 2); // 200 short
        vm.warp(block.timestamp + 1 hours);

        int256 aliceOwes = market.fundingOwed(alice);
        int256 bobOwes = market.fundingOwed(bob);
        assertGt(aliceOwes, 0);
        assertLt(bobOwes, 0);
        // skew 800 on a ~10,001.2 pool at 0.1%/h → ~0.08 USDC per 1,000 notional
        assertApproxEqAbs(aliceOwes, 79_990, 20);
        // net goes to the pool
        assertGt(aliceOwes + bobOwes, 0);
    }

    function test_fundingShortHeavyReverses() public {
        _open(bob, false, 100e6, 10);
        vm.warp(block.timestamp + 1 hours);
        assertLt(market.currentFundingIndex(), 0);
        assertGt(market.fundingOwed(bob), 0);
    }

    function test_fundingAccruesOnTick() public {
        _open(alice, true, 100e6, 10);
        market.revive();
        vm.warp(market.nextRunAt());
        _tick();
        assertGt(market.fundingIndex(), 0);
        assertEq(market.fundingUpdatedAt(), block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                         SAUCERSWAP: OPEN WITH HBAR
    //////////////////////////////////////////////////////////////*/

    function test_openWithHbarSwapsToCollateral() public {
        vm.deal(alice, 10e8);
        assertEq(market.quoteHbarToUsdc(10e8), 22.7e6); // 10 HBAR at 2.27 USDC
        vm.expectEmit(true, false, false, true, address(market));
        emit PerpMarket.SwappedHbarForCollateral(alice, 10e8, 22.7e6);
        vm.prank(alice);
        market.openWithHbar{ value: 10e8 }(true, 10, 22.7e6);

        MarginAccount.Position memory p = market.positionOf(alice);
        assertEq(p.entryNotional, 227e6);
        assertEq(p.collateral, 22.7e6 - 0.227e6); // open fee 10 bps of notional
        assertEq(usdc.balanceOf(address(market)), p.collateral);
        assertEq(address(router).balance, 1_000_000e8 + 10e8);
    }

    function test_openWithHbarRespectsSlippage() public {
        vm.deal(alice, 10e8);
        vm.prank(alice);
        vm.expectRevert(bytes("slippage"));
        market.openWithHbar{ value: 10e8 }(true, 10, 22.7e6 + 1);
    }

    function test_openWithHbarRejectsZeroAndDisabled() public {
        vm.prank(alice);
        vm.expectRevert(PerpMarket.PerpMarket__ZeroAmount.selector);
        market.openWithHbar(true, 10, 0);

        PerpMarket noSwap = new PerpMarket(
            address(usdc), address(guard), address(pool), address(this), 300, 2_000_000, 1e8, address(0), address(0), 1e6, 9_500
        );
        vm.deal(alice, 1e8);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.PerpMarket__SwapDisabled.selector);
        noSwap.openWithHbar{ value: 1e8 }(true, 10, 0);
        vm.prank(address(noSwap));
        vm.expectRevert(PerpMarket.PerpMarket__SwapDisabled.selector);
        noSwap.refuel();
    }

    /*//////////////////////////////////////////////////////////////
                      SAUCERSWAP: SELF-FUNDING KEEPER
    //////////////////////////////////////////////////////////////*/

    function test_refuelSwapsPoolUsdcToHbar() public {
        vm.deal(address(market), 5e8); // 5 runs left, under the line of 12
        uint256 poolBefore = usdc.balanceOf(address(pool));

        // wants (48 - 5) runs = 43 HBAR ≈ 97.61 USDC, capped at 50 USDC per refuel
        vm.expectEmit(false, false, false, true, address(market));
        emit PerpMarket.Refueled(50e6, uint256(50e6) * 1e8 / 2_270_000, 5);
        vm.prank(address(market));
        uint256 hbarOut = market.refuel();

        assertEq(poolBefore - usdc.balanceOf(address(pool)), 50e6);
        assertEq(address(market).balance, 5e8 + hbarOut);
        assertEq(usdc.balanceOf(address(market)), 0); // nothing left over in the market
        assertEq(market.runsLeft(), 27);
    }

    function test_refuelBuysOnlyWhatItNeeds() public {
        vm.deal(address(market), 11e8); // one run short of the line: wants 37 HBAR ≈ 83.99 USDC → capped at 50
        router.setRate(1_000_000); // 1 HBAR = 1 USDC: wants 37 USDC, under the cap
        vm.prank(address(market));
        market.refuel();
        assertEq(market.runsLeft(), 48);
    }

    function test_refuelOnlyWhenLow() public {
        vm.expectRevert(abi.encodeWithSelector(PerpMarket.PerpMarket__ReserveNotLow.selector, 100));
        vm.prank(address(market));
        market.refuel();
    }

    function test_refuelNeverTouchesLiquidityPositionsNeed() public {
        _open(alice, true, 100e6, 10); // pool must keep 2,000
        uint256 max = pool.maxWithdraw(lp);
        vm.prank(lp);
        pool.withdraw(max, lp);
        vm.deal(address(market), 1e8);

        uint256 free = pool.freeAssets();
        if (free == 0) {
            vm.expectRevert(PerpMarket.PerpMarket__NothingToSpend.selector);
            vm.prank(address(market));
        market.refuel();
        } else {
            vm.prank(address(market));
        market.refuel();
        }
        assertGe(pool.totalAssets(), pool.requiredLiquidity());
    }

    function test_onlyMarketPaysKeeper() public {
        vm.expectRevert(LiquidityPool.LiquidityPool__OnlyMarket.selector);
        pool.payKeeper(1);
    }

    function test_tickRefuelsWhenLow() public {
        market.revive();
        vm.deal(address(market), 5e8);
        vm.warp(market.nextRunAt());
        vm.expectEmit(false, false, false, false, address(market));
        emit PerpMarket.Refueled(0, 0, 0);
        _tick();
        assertGt(market.runsLeft(), 12);
        assertEq(market.nextRunAt(), block.timestamp + 300);
    }

    function test_failedRefuelNeverUndoesTheSweep() public {
        _open(alice, true, 10e6, 50);
        market.revive();
        vm.deal(address(market), 5e8);
        router.setRate(0); // SaucerSwap quote breaks: refuel reverts
        vm.warp(market.nextRunAt());
        _setPrice(11_880_000);
        _tick();

        assertEq(market.positionOf(alice).size, 0); // liquidated anyway
        assertEq(market.nextRunAt(), block.timestamp + 300);
        assertEq(address(market).balance, 5e8);
    }

    /*//////////////////////////////////////////////////////////////
                                ADMIN
    //////////////////////////////////////////////////////////////*/

    function test_requiredLiquidityIsTwiceOpenInterest() public {
        _open(alice, true, 100e6, 10);
        assertEq(market.requiredLiquidity(), 2000e6);
    }

    function test_setRunCostEstimateOnlyOwner() public {
        market.setRunCostEstimate(5e7);
        assertEq(market.runCostEstimate(), 5e7);
        vm.prank(alice);
        vm.expectRevert();
        market.setRunCostEstimate(1);
    }

    function test_associateDoesNotRevertOffHedera() public {
        assertFalse(market.associate());
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(PerpMarket.PerpMarket__InvalidAddress.selector);
        new PerpMarket(
            address(0), address(guard), address(pool), address(this), 300, 2_000_000, 0, address(0), address(0), 1e6, 9_500
        );
        vm.expectRevert(PerpMarket.PerpMarket__InvalidAddress.selector); // router without WHBAR
        new PerpMarket(
            address(usdc), address(guard), address(pool), address(this), 300, 2_000_000, 0, address(router), address(0), 1e6, 9_500
        );
    }
}
