// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { CustosBase } from "./CustosBase.sol";
import { PerpMarket } from "../contracts/PerpMarket.sol";
import { MarginAccount } from "../contracts/MarginAccount.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";

/// @dev Property tests: USDC is conserved across trader/pool/market(/router) and the payout math is exact.
contract PerpMarketFuzzTest is CustosBase {
    uint256 internal constant P8 = 12_000_000; // $0.12, the base price
    uint256 internal constant CAP = POOL_SEED / 2; // OI cap with the seeded pool

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Bounds (collateral, leverage) so notional stays within `maxNotional`.
    function _bounds(uint256 c, uint256 lev, uint256 minLev, uint256 maxNotional)
        internal
        pure
        returns (uint256, uint256)
    {
        c = bound(c, MIN_COLLATERAL, 500e6);
        uint256 maxLev = maxNotional / c;
        if (maxLev > 50) maxLev = 50;
        if (minLev > maxLev) minLev = maxLev;
        return (c, bound(lev, minLev, maxLev));
    }

    function _moved(uint256 price8, int256 bps) internal pure returns (uint256) {
        return uint256(int256(price8) * (10_000 + bps) / 10_000);
    }

    /// @dev Funding owed by a lone position, recomputed from the formula (index starts at 0).
    function _owed(uint256 notional, bool isLong, uint256 dt, uint256 assets) internal pure returns (int256) {
        int256 skew = isLong ? int256(notional) : -int256(notional);
        int256 idx = int256(1e15) * skew * int256(dt) / (int256(assets) * 3600);
        int256 owed = idx * int256(notional) / 1e18;
        return isLong ? owed : -owed;
    }

    /// @dev Payout of alice's lone position (opened at P8, index 0) recomputed from scratch, cross-checked with views.
    function _expectedPayout(bool isLong, uint256 c, uint256 n, uint256 np8, uint256 dt, uint256 assets)
        internal
        view
        returns (uint256)
    {
        int256 size = int256(n * 1e30 / 0.12e18);
        if (!isLong) size = -size;
        int256 pnl = size * (int256(np8 * 1e10) - int256(0.12e18)) / 1e30;
        int256 owed = _owed(n, isLong, dt, assets);
        assertEq(market.pnl(alice, np8 * 1e10), pnl);
        assertEq(market.fundingOwed(alice), owed);
        int256 gain = pnl - owed;
        if (gain > int256(n)) gain = int256(n);
        int256 eq = int256(c - n / 1000) + gain;
        assertEq(market.equity(alice, np8 * 1e10), eq);
        return eq > int256(n / 1000) ? uint256(eq - int256(n / 1000)) : 0;
    }

    function _usdcTotal(address[] memory who) internal view returns (uint256 t) {
        t = usdc.balanceOf(address(pool)) + usdc.balanceOf(address(market)) + usdc.balanceOf(address(router));
        for (uint256 i = 0; i < who.length; i++) {
            t += usdc.balanceOf(who[i]);
        }
    }

    function _trader(uint256 i) internal returns (address t) {
        t = address(uint160(0x5000 + i));
        _fund(t, 1_000e6);
    }

    /*//////////////////////////////////////////////////////////////
                         OPEN / CLOSE CONSERVATION
    //////////////////////////////////////////////////////////////*/

    function testFuzz_openFeeAndPositionMath(bool isLong, uint256 c, uint256 lev, uint256 price8) public {
        (c, lev) = _bounds(c, lev, 1, CAP);
        price8 = bound(price8, 1e6, 1e9); // $0.01 .. $10
        _setPrice(price8);
        uint256 n = c * lev;
        uint256 poolBefore = usdc.balanceOf(address(pool));

        _open(alice, isLong, c, lev);

        MarginAccount.Position memory p = market.positionOf(alice);
        int256 size = int256(n * 1e30 / (price8 * 1e10));
        assertEq(p.size, isLong ? size : -size);
        assertEq(p.collateral, c - n / 1000);
        assertEq(p.entryNotional, n);
        assertEq(p.entryPrice, price8 * 1e10);
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, n / 1000);
        assertEq(usdc.balanceOf(address(market)), p.collateral);
        assertEq(market.totalCollateral(), p.collateral);
        assertEq(market.requiredLiquidity(), 2 * n);
        assertEq(isLong ? market.longNotional() : market.shortNotional(), n);
    }

    function testFuzz_openCloseConservesUsdc(bool isLong, uint256 c, uint256 lev, int256 bps, uint256 hold) public {
        (c, lev) = _bounds(c, lev, 1, CAP);
        bps = bound(bps, -3000, 3000);
        hold = bound(hold, 300, 7 days);
        uint256 n = c * lev;
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 poolBefore = usdc.balanceOf(address(pool));

        _open(alice, isLong, c, lev);
        uint256 assets = usdc.balanceOf(address(pool));

        vm.warp(block.timestamp + hold);
        uint256 np8 = _moved(P8, bps);
        _setPrice(np8);
        uint256 payout = _expectedPayout(isLong, c, n, np8, hold, assets);

        vm.prank(alice);
        market.close();

        int256 traderDelta = int256(usdc.balanceOf(alice)) - int256(aliceBefore);
        int256 poolDelta = int256(usdc.balanceOf(address(pool))) - int256(poolBefore);
        assertEq(traderDelta, int256(payout) - int256(c));
        assertEq(traderDelta + poolDelta, 0);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(market.totalCollateral(), 0);
        assertEq(market.traderCount(), 0);
    }

    function testFuzz_gainCappedAtEntryNotional(bool isLong, uint256 c, uint256 lev, uint256 mult, uint256 hold)
        public
    {
        (c, lev) = _bounds(c, lev, 1, CAP);
        hold = bound(hold, 300, 7 days);
        uint256 n = c * lev;
        _open(alice, isLong, c, lev);
        uint256 collateral = c - n / 1000;
        uint256 poolAfterOpen = usdc.balanceOf(address(pool));

        vm.warp(block.timestamp + hold);
        // longs: 2.1x..100x up; shorts: down to 1% of entry (best case for a short)
        uint256 np8 = isLong ? P8 * bound(mult, 21, 1000) / 10 : P8 / 100;
        _setPrice(np8);
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        market.close();
        uint256 payout = usdc.balanceOf(alice) - aliceBefore;

        assertLe(payout, collateral + n - n / 1000);
        assertLe(poolAfterOpen - usdc.balanceOf(address(pool)), n); // pool never pays more than notional
        if (isLong) assertEq(payout, collateral + n - n / 1000); // cap binds exactly
    }

    function testFuzz_closeBeforeMinHoldReverts(uint256 wait) public {
        wait = bound(wait, 0, 299);
        _open(alice, true, 10e6, 5);
        uint256 openedAt = block.timestamp;
        vm.warp(block.timestamp + wait);
        _setPrice(P8);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpMarket.PerpMarket__HoldTime.selector, openedAt + 300));
        market.close();
    }

    function testFuzz_addCollateralMovesLiquidationAway(bool isLong, uint256 c, uint256 lev, uint256 extra) public {
        (c, lev) = _bounds(c, lev, 2, CAP);
        extra = bound(extra, 1e6, 400e6);
        _open(alice, isLong, c, lev);
        uint256 liqBefore = market.liquidationPrice(alice);
        uint256 marketBefore = usdc.balanceOf(address(market));
        vm.prank(alice);
        market.addCollateral(extra);
        uint256 liqAfter = market.liquidationPrice(alice);
        assertEq(usdc.balanceOf(address(market)) - marketBefore, extra);
        assertEq(market.totalCollateral(), usdc.balanceOf(address(market)));
        if (isLong) assertTrue(liqAfter < liqBefore || liqAfter == 0);
        else assertGt(liqAfter, liqBefore);
    }

    /*//////////////////////////////////////////////////////////////
                              LIQUIDATION
    //////////////////////////////////////////////////////////////*/

    function testFuzz_isLiquidatableAtLiquidationPrice(bool isLong, uint256 c, uint256 lev, uint256 price8, uint256 dt)
        public
    {
        (c, lev) = _bounds(c, lev, 1, CAP);
        price8 = bound(price8, 1e6, 1e9);
        dt = bound(dt, 0, 7 days);
        _setPrice(price8);
        _open(alice, isLong, c, lev);
        vm.warp(block.timestamp + dt);

        uint256 liq = market.liquidationPrice(alice);
        uint256 p = price8 * 1e10;
        uint256 tol = 4 * p / (c * lev) + 1; // one micro-USDC of PnL is p/notional of price
        if (isLong) {
            assertFalse(market.isLiquidatable(alice, liq + tol));
            if (liq > tol) assertTrue(market.isLiquidatable(alice, liq - tol));
        } else {
            assertTrue(market.isLiquidatable(alice, liq + tol));
            assertFalse(market.isLiquidatable(alice, liq - tol));
        }
    }

    function testFuzz_manualLiquidationSplitsCollateral(bool isLong, uint256 c, uint256 lev, uint256 extra) public {
        (c, lev) = _bounds(c, lev, 10, CAP);
        _open(alice, isLong, c, lev);
        uint256 n = c * lev;
        uint256 collateral = c - n / 1000;
        uint256 liq8 = market.liquidationPrice(alice) / 1e10;
        uint256 price8 = isLong ? liq8 - 100 - bound(extra, 0, liq8 / 2) : liq8 + 101 + bound(extra, 0, liq8);
        _setPrice(price8);

        uint256 poolBefore = usdc.balanceOf(address(pool));
        uint256 reward = n * 50 / 10_000;
        if (reward > collateral) reward = collateral;
        vm.expectEmit(true, true, false, true, address(market));
        emit PerpMarket.Liquidated(alice, price8 * 1e10, false, liquidator, reward);
        vm.prank(liquidator);
        market.liquidate(alice);

        assertEq(usdc.balanceOf(liquidator), reward);
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, collateral - reward);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(market.totalCollateral(), 0);
        assertEq(market.traderCount(), 0);
    }

    function testFuzz_liquidateHealthyReverts(bool isLong, uint256 c, uint256 lev, uint256 frac) public {
        (c, lev) = _bounds(c, lev, 2, CAP);
        _open(alice, isLong, c, lev);
        uint256 liq8 = market.liquidationPrice(alice) / 1e10;
        // anywhere strictly on the healthy side of the liquidation price, within the 0..2x entry range
        uint256 price8 = isLong ? bound(frac, liq8 + 100, P8 * 2) : bound(frac, P8 / 10, liq8 - 100);
        _setPrice(price8);
        vm.prank(liquidator);
        vm.expectRevert(PerpMarket.PerpMarket__NotLiquidatable.selector);
        market.liquidate(alice);
    }

    function testFuzz_noLiquidationAtDeviatedPrice(uint256 c, uint256 lev, uint256 gapBps) public {
        (c, lev) = _bounds(c, lev, 10, CAP);
        gapBps = bound(gapBps, 301, 2000);
        _open(alice, true, c, lev);
        uint256 liq8 = market.liquidationPrice(alice) / 1e10;
        uint256 cl8 = liq8 - 100; // underwater on Chainlink
        chainlink.set(int256(cl8), block.timestamp);
        supra.set(cl8 * (10_000 + gapBps) / 10_000 + 1, block.timestamp);
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PriceGuard__NotOk.selector, PriceGuard.Status.Deviated));
        market.liquidate(alice);
    }

    function testFuzz_networkLiquidationGivesPoolAllCollateral(bool isLong, uint256 c, uint256 lev, uint256 extra)
        public
    {
        (c, lev) = _bounds(c, lev, 10, CAP);
        _open(alice, isLong, c, lev);
        uint256 collateral = c - c * lev / 1000;
        market.revive();
        vm.warp(market.nextRunAt());
        _setPrice(P8);
        uint256 liq8 = market.liquidationPrice(alice) / 1e10;
        uint256 price8 = isLong ? liq8 - 100 - bound(extra, 0, liq8 / 2) : liq8 + 101 + bound(extra, 0, liq8);
        _setPrice(price8);

        uint256 poolBefore = usdc.balanceOf(address(pool));
        vm.expectEmit(true, true, false, true, address(market));
        emit PerpMarket.Liquidated(alice, price8 * 1e10, true, address(0), 0);
        _tick();

        assertEq(usdc.balanceOf(address(pool)) - poolBefore, collateral);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(market.traderCount(), 0);
    }

    function testFuzz_tickSparesHealthyPositions(bool isLong, uint256 c, uint256 lev, int256 bps) public {
        (c, lev) = _bounds(c, lev, 1, CAP);
        _open(alice, isLong, c, lev);
        market.revive();
        vm.warp(market.nextRunAt());
        _setPrice(P8);
        uint256 liq8 = market.liquidationPrice(alice) / 1e10;
        uint256 price8 = _moved(P8, bound(bps, -3000, 3000));
        if (isLong ? price8 <= liq8 + 100 : price8 + 100 >= liq8) return; // only the healthy side
        _setPrice(price8);
        uint256 marketBefore = usdc.balanceOf(address(market));
        _tick();
        assertEq(market.traderCount(), 1);
        assertEq(usdc.balanceOf(address(market)), marketBefore);
    }

    /*//////////////////////////////////////////////////////////////
                                FUNDING
    //////////////////////////////////////////////////////////////*/

    function testFuzz_fundingHeavySidePays(uint256 c1, uint256 l1, uint256 c2, uint256 l2, uint256 dt) public {
        (c1, l1) = _bounds(c1, l1, 1, CAP / 2);
        (c2, l2) = _bounds(c2, l2, 1, CAP / 2);
        dt = bound(dt, 300, 30 days);
        _open(alice, true, c1, l1);
        _open(bob, false, c2, l2);
        vm.warp(block.timestamp + dt);

        int256 a = market.fundingOwed(alice);
        int256 b = market.fundingOwed(bob);
        int256 idx = market.currentFundingIndex();
        uint256 nl = c1 * l1;
        uint256 ns = c2 * l2;
        if (nl == ns) {
            assertEq(idx, 0);
            assertEq(a, 0);
            assertEq(b, 0);
        } else if (nl > ns) {
            assertGt(idx, 0);
            assertGe(a, 0); // heavy long pays
            assertLe(b, 0); // light short is paid
            assertGe(a + b, 0); // the difference goes to the pool
        } else {
            assertLt(idx, 0);
            assertLe(a, 0);
            assertGe(b, 0);
            assertGe(a + b, 0);
        }
        // net funding equals the skew's share, up to rounding
        assertApproxEqAbs(a + b, idx * (int256(nl) - int256(ns)) / 1e18, 2);
    }

    function testFuzz_symmetricBookFundingNetsZero(uint256 c, uint256 lev, uint256 dt) public {
        (c, lev) = _bounds(c, lev, 1, CAP / 2);
        dt = bound(dt, 300, 30 days);
        _open(alice, true, c, lev);
        _open(bob, false, c, lev);
        vm.warp(block.timestamp + dt);
        assertEq(market.fundingOwed(alice), 0);
        assertEq(market.fundingOwed(bob), 0);
        assertEq(market.currentFundingIndex(), 0);
    }

    /// @dev Every state-changing entry point brings funding up to date first.
    function testFuzz_fundingAccruesOnEveryEntryPoint(uint256 action, uint256 dt) public {
        action = bound(action, 0, 4);
        dt = bound(dt, 300, 3000);
        _open(alice, true, 10e6, 50); // 500 long, skew drives the index up
        if (action == 3) market.revive();
        vm.warp(block.timestamp + dt);
        _setPrice(action == 2 ? 11_000_000 : P8); // -8.3%: alice underwater for liquidate
        int256 expected = market.currentFundingIndex();
        assertGt(expected, 0);

        if (action == 0) {
            _open(bob, false, 10e6, 2);
        } else if (action == 1) {
            vm.prank(alice);
            market.close();
        } else if (action == 2) {
            vm.prank(liquidator);
            market.liquidate(alice);
        } else if (action == 3) {
            vm.warp(market.nextRunAt() > block.timestamp ? market.nextRunAt() : block.timestamp);
            _setPrice(P8);
            expected = market.currentFundingIndex();
            _tick();
        } else {
            market.accrueFunding();
        }
        assertEq(market.fundingIndex(), expected);
        assertEq(market.fundingUpdatedAt(), block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                              CLOSE PRICE
    //////////////////////////////////////////////////////////////*/

    function testFuzz_closePriceOkIsChainlink(bool isLong, uint256 cl8, uint256 gapBps, bool up) public {
        cl8 = bound(cl8, 1e6, 1e9);
        gapBps = bound(gapBps, 0, 299);
        uint256 s8 = up ? cl8 * (10_000 + gapBps) / 10_000 : cl8 * (10_000 - gapBps) / 10_000;
        _open(alice, isLong, 10e6, 2);
        chainlink.set(int256(cl8), block.timestamp);
        supra.set(s8, block.timestamp);
        assertEq(uint256(guard.status()), uint256(PriceGuard.Status.Ok));
        assertEq(market.closePrice(alice), cl8 * 1e10);
    }

    /// @dev Deviated or stale: a long settles at the lower feed, a short at the higher, and the close pays exactly that.
    function testFuzz_closeAtBadPriceUsesWorseFeed(bool isLong, uint256 cl8, uint256 s8, bool stale) public {
        cl8 = bound(cl8, 9_000_000, 15_000_000);
        s8 = bound(s8, 9_000_000, 15_000_000);
        _open(alice, isLong, 100e6, 5);
        vm.warp(block.timestamp + 300 + (stale ? 3600 : 0));
        chainlink.set(int256(cl8), stale ? block.timestamp - 3601 : block.timestamp);
        supra.set(s8, block.timestamp);
        PriceGuard.Status st = guard.status();
        if (st == PriceGuard.Status.Ok) return; // close feeds, fresh: covered by the Ok test

        uint256 lo = cl8 < s8 ? cl8 : s8;
        uint256 hi = cl8 < s8 ? s8 : cl8;
        // a stale Chainlink is left out entirely: only the fresh feed (Supra) can settle the close
        uint256 want = stale ? s8 * 1e10 : (isLong ? lo : hi) * 1e10;
        assertEq(market.closePrice(alice), want);

        int256 eq = market.equity(alice, want);
        uint256 fee = 500e6 / 1000;
        uint256 payout = eq > int256(fee) ? uint256(eq) - fee : 0;
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        market.close();
        assertEq(usdc.balanceOf(alice) - before, payout);
    }

    function testFuzz_closePriceOneFeedDown(bool isLong, uint256 p8, bool chainlinkDown) public {
        p8 = bound(p8, 1e6, 1e9);
        _open(alice, isLong, 10e6, 2);
        if (chainlinkDown) {
            chainlink.set(0, block.timestamp);
            supra.set(p8, block.timestamp);
        } else {
            chainlink.set(int256(p8), block.timestamp);
            supra.set(0, block.timestamp);
        }
        assertEq(market.closePrice(alice), p8 * 1e10);
    }

    function testFuzz_closeRevertsWithNoPrice(bool isLong, uint256 hold) public {
        hold = bound(hold, 300, 7 days);
        _open(alice, isLong, 10e6, 2);
        vm.warp(block.timestamp + hold);
        chainlink.set(0, block.timestamp);
        supra.set(0, block.timestamp);
        assertEq(market.closePrice(alice), 0);
        vm.prank(alice);
        vm.expectRevert(PerpMarket.PerpMarket__NoPrice.selector);
        market.close();
    }

    /*//////////////////////////////////////////////////////////////
                              HBAR PATHS
    //////////////////////////////////////////////////////////////*/

    function testFuzz_closeToHbarPaysAtRouterRate(bool isLong, uint256 c, uint256 lev, int256 bps) public {
        (c, lev) = _bounds(c, lev, 1, CAP);
        _open(alice, isLong, c, lev);
        vm.warp(block.timestamp + 300);
        uint256 np8 = _moved(P8, bound(bps, -3000, 3000));
        _setPrice(np8);
        int256 eq = market.equity(alice, np8 * 1e10);
        uint256 fee = c * lev / 1000;
        uint256 payout = eq > int256(fee) ? uint256(eq) - fee : 0;
        uint256 hbarWant = payout * 1e8 / 2_270_000;

        address[] memory who = new address[](1);
        who[0] = alice;
        uint256 totalBefore = _usdcTotal(who);
        uint256 hbarBefore = alice.balance;
        uint256 aliceUsdc = usdc.balanceOf(alice);
        uint256 routerUsdc = usdc.balanceOf(address(router));

        vm.prank(alice);
        uint256 out = market.closeToHbar(hbarWant);

        assertEq(out, hbarWant);
        assertEq(alice.balance - hbarBefore, hbarWant);
        assertEq(usdc.balanceOf(alice), aliceUsdc); // nothing in USDC
        assertEq(usdc.balanceOf(address(router)) - routerUsdc, payout);
        assertEq(_usdcTotal(who), totalBefore);
        assertEq(usdc.balanceOf(address(market)), 0);
    }

    function testFuzz_closeToHbarSlippageReverts(uint256 c, uint256 lev, uint256 more) public {
        (c, lev) = _bounds(c, lev, 1, CAP);
        _open(alice, true, c, lev);
        vm.warp(block.timestamp + 300);
        _setPrice(P8);
        int256 eq = market.equity(alice, P8 * 1e10);
        uint256 payout = uint256(eq) - c * lev / 1000; // flat price: always positive
        uint256 quote = market.quoteUsdcToHbar(payout);
        assertEq(quote, payout * 1e8 / 2_270_000);
        vm.prank(alice);
        vm.expectRevert(bytes("slippage"));
        market.closeToHbar(quote + bound(more, 1, 1e18));
    }

    function testFuzz_closeToHbarZeroPayoutSendsNothing(bool isLong, uint256 c) public {
        c = bound(c, MIN_COLLATERAL, 100e6);
        _open(alice, isLong, c, 50);
        vm.warp(block.timestamp + 300);
        _setPrice(isLong ? 9_000_000 : 15_000_000); // 25% against at 50x: deep underwater
        uint256 collateral = c - c * 50 / 1000;
        uint256 poolBefore = usdc.balanceOf(address(pool));
        uint256 hbarBefore = alice.balance;
        vm.prank(alice);
        uint256 out = market.closeToHbar(0);
        assertEq(out, 0);
        assertEq(alice.balance, hbarBefore);
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, collateral);
        assertEq(usdc.balanceOf(address(market)), 0);
    }

    function testFuzz_openWithHbar(bool isLong, uint256 value, uint256 lev) public {
        value = bound(value, 1, 2_000e8);
        uint256 collateral = value * 2_270_000 / 1e8;
        vm.deal(alice, value);
        if (collateral < MIN_COLLATERAL) {
            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(PerpMarket.PerpMarket__BelowMinCollateral.selector, MIN_COLLATERAL));
            market.openWithHbar{ value: value }(isLong, 1, 0);
            return;
        }
        uint256 maxLev = CAP / collateral;
        if (maxLev > 50) maxLev = 50;
        lev = bound(lev, 1, maxLev);
        assertEq(market.quoteHbarToUsdc(value), collateral);
        vm.prank(alice);
        market.openWithHbar{ value: value }(isLong, lev, collateral);

        MarginAccount.Position memory p = market.positionOf(alice);
        assertEq(p.entryNotional, collateral * lev);
        assertEq(p.collateral, collateral - collateral * lev / 1000);
        assertEq(usdc.balanceOf(address(market)), p.collateral);
        assertEq(address(router).balance, 1_000_000e8 + value);
    }

    /*//////////////////////////////////////////////////////////////
                           POOL AND BOOK-WIDE
    //////////////////////////////////////////////////////////////*/

    function testFuzz_openInterestCap(uint256 c1, uint256 l1, uint256 c2, uint256 l2) public {
        (c1, l1) = _bounds(c1, l1, 1, CAP);
        c2 = bound(c2, MIN_COLLATERAL, 2_000e6);
        l2 = bound(l2, 1, 50);
        _fund(bob, 2_000e6);
        _open(alice, true, c1, l1);
        uint256 cap = usdc.balanceOf(address(pool)) * 5_000 / 10_000;
        bool over = market.totalOpenNotional() + c2 * l2 > cap;
        vm.prank(bob);
        if (over) vm.expectRevert(abi.encodeWithSelector(PerpMarket.PerpMarket__OpenInterestCap.selector, cap));
        market.open(false, c2, l2);
        if (!over) assertEq(market.totalOpenNotional(), c1 * l1 + c2 * l2);
    }

    function testFuzz_poolValueBooksNetTraderGain(uint256 seed, uint256 count, int256 bps, uint256 dt) public {
        count = bound(count, 2, 6);
        uint256 budget = CAP / count;
        address[] memory t = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            t[i] = _trader(i);
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            (uint256 c, uint256 lev) = _bounds(r, r >> 64, 1, budget);
            _open(t[i], r & 1 == 0, c, lev);
        }
        vm.warp(block.timestamp + bound(dt, 0, 7 days));
        uint256 p = _moved(P8, bound(bps, -3000, 3000)) * 1e10;
        _setPrice(p / 1e10);

        int256 net = market.netTraderGain(p);
        int256 sum;
        for (uint256 i = 0; i < count; i++) {
            sum += market.pnl(t[i], p) - market.fundingOwed(t[i]);
        }
        int256 floor = -int256(market.totalCollateral());
        if (sum - int256(2 * count) > floor) assertApproxEqAbs(net, sum, 2 * count);
        assertGe(net, floor);

        int256 v = int256(usdc.balanceOf(address(pool))) - net;
        assertEq(pool.totalAssets(), v > 0 ? uint256(v) : 0);
        (int256 g, bool ok) = market.traderGainForPool();
        assertTrue(ok);
        assertEq(g, net);
    }

    function testFuzz_randomOpenCloseSequenceDrainsBook(uint256 seed, uint256 count) public {
        count = bound(count, 3, 8);
        uint256 budget = CAP / count;
        address[] memory t = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            t[i] = _trader(i);
        }
        uint256 totalBefore = _usdcTotal(t);
        uint256 lpShares = pool.balanceOf(lp);

        for (uint256 i = 0; i < count; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            (uint256 c, uint256 lev) = _bounds(r, r >> 64, 1, budget);
            _open(t[i], r & 1 == 0, c, lev);
            vm.warp(block.timestamp + (r >> 128) % 600);
            _setPrice(_moved(P8, int256((r >> 160) % 2001) - 1000)); // ±10%
        }
        // close in a seed-shuffled order
        for (uint256 i = count; i > 0; i--) {
            uint256 j = uint256(keccak256(abi.encode(seed, "shuffle", i))) % i;
            (t[i - 1], t[j]) = (t[j], t[i - 1]);
        }
        vm.warp(block.timestamp + 300);
        for (uint256 i = 0; i < count; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, "close", i)));
            vm.warp(block.timestamp + r % 3600);
            _setPrice(_moved(P8, int256((r >> 128) % 2001) - 1000));
            vm.prank(t[i]);
            market.close();
        }

        assertEq(market.traderCount(), 0);
        assertEq(market.totalCollateral(), 0);
        assertEq(market.longNotional(), 0);
        assertEq(market.shortNotional(), 0);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(market.netTraderGain(P8 * 1e10), 0); // running sums back to zero
        assertEq(_usdcTotal(t), totalBefore); // no USDC created or destroyed
        assertEq(pool.balanceOf(lp), lpShares);
        assertEq(pool.totalAssets(), usdc.balanceOf(address(pool)));
    }
}
