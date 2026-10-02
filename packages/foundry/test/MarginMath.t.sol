// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { MarginAccount } from "../contracts/MarginAccount.sol";

/// @dev Exposes MarginAccount's internals with a settable funding base.
contract MarginHarness is MarginAccount {
    uint256 public poolAssets;

    function setPoolAssets(uint256 a) external {
        poolAssets = a;
    }

    function _fundingPoolAssets() internal view override returns (uint256) {
        return poolAssets;
    }

    /// @dev Mirrors PerpMarket: accrue, then book.
    function add(address trader, int256 size, uint256 collateral, uint256 price, uint256 notional) external {
        _accrueFunding();
        _addPosition(trader, size, collateral, price, notional);
    }

    function remove(address trader) external {
        _accrueFunding();
        _removePosition(trader);
    }

    function accrue() external {
        _accrueFunding();
    }

    function addCollateral(address trader, uint256 amount) external {
        _addCollateral(trader, amount);
    }

    function slotOf(address trader) external view returns (uint256) {
        return _slot[trader];
    }

    function sums() external view returns (int256, int256, int256, int256) {
        return (_sumSize, _sumSizeEntry, _sumSignedNotional, _sumSignedNotionalIndex);
    }
}

contract MarginMathTest is Test {
    uint256 internal constant ASSETS = 10_000e6;
    uint256 internal constant P0 = 0.12e18;

    MarginHarness internal m;

    function setUp() public {
        vm.warp(1_000_000);
        m = new MarginHarness();
        m.setPoolAssets(ASSETS);
    }

    /// @dev Opens like PerpMarket: notional = collateral × leverage, size = notional × 1e30 / price.
    function _open(address who, bool isLong, uint256 notional, uint256 leverage, uint256 price)
        internal
        returns (int256 size)
    {
        uint256 abs = notional * 1e30 / price;
        size = isLong ? int256(abs) : -int256(abs);
        m.add(who, size, notional / leverage, price, notional);
    }

    function _bounds(uint256 notional, uint256 leverage, uint256 price)
        internal
        pure
        returns (uint256, uint256, uint256)
    {
        return (bound(notional, 1e6, 1e12), bound(leverage, 1, 50), bound(price, 1e15, 1e20));
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    /*//////////////////////////////////////////////////////////////
                              PNL / EQUITY
    //////////////////////////////////////////////////////////////*/

    /// PnL = size × Δprice / 1e30: sign follows side × direction, zero at entry.
    function testFuzz_pnlSignAndMagnitude(uint256 notional, uint256 entry, uint256 exit, bool isLong) public {
        uint256 lev;
        (notional, lev, entry) = _bounds(notional, 1, entry);
        exit = bound(exit, 0, 1e20);
        address t = address(0x1);
        int256 size = _open(t, isLong, notional, 1, entry);

        int256 p = m.pnl(t, exit);
        assertEq(p, size * (int256(exit) - int256(entry)) / 1e30);
        assertEq(m.pnl(t, entry), 0);
        if (exit == entry) assertEq(p, 0);
        else if ((exit > entry) == isLong) assertGe(p, 0);
        else assertLe(p, 0);
        // |pnl| ≈ notional × |Δp| / entry (size rounding is < 1 HBAR-wei)
        uint256 diff = exit > entry ? exit - entry : entry - exit;
        assertApproxEqAbs(_abs(p), notional * diff / entry, 2);
    }

    /// Equity's gain is capped at entry notional; losses are not floored.
    function testFuzz_equityGainCap(uint256 notional, uint256 lev, uint256 entry, uint256 exit, bool isLong) public {
        (notional, lev, entry) = _bounds(notional, lev, entry);
        exit = bound(exit, 0, 1e21);
        address t = address(0x1);
        _open(t, isLong, notional, lev, entry);
        uint256 coll = notional / lev;

        int256 p = m.pnl(t, exit);
        int256 eq = m.equity(t, exit);
        assertLe(eq, int256(coll + notional));
        if (p <= int256(notional)) assertEq(eq, int256(coll) + p);
        else assertEq(eq, int256(coll + notional));
    }

    function test_longGainCappedAtDoubling() public {
        address t = address(0x1);
        _open(t, true, 1000e6, 10, 1e18);
        assertEq(m.equity(t, 2e18), int256(100e6 + 1000e6)); // +100%: exactly at the cap
        assertEq(m.equity(t, 5e18), int256(100e6 + 1000e6)); // +400%: capped
        assertEq(m.equity(t, 0.5e18), int256(100e6) - 500e6); // -50%: negative equity, no floor
    }

    function testFuzz_maintenanceMargin(uint256 notional, uint256 lev, uint256 price) public {
        (notional, lev, price) = _bounds(notional, lev, price);
        address t = address(0x1);
        _open(t, true, notional, lev, price);
        assertEq(m.maintenanceMargin(t), notional / 100);
        assertEq(m.maintenanceMargin(address(0x2)), 0);
    }

    /// isLiquidatable ⇔ equity < maintenance margin, at any price and funding state.
    function testFuzz_isLiquidatableIffEquityBelowMaintenance(
        uint256 notional,
        uint256 lev,
        uint256 entry,
        uint256 exit,
        uint256 dt,
        bool isLong
    ) public {
        (notional, lev, entry) = _bounds(notional, lev, entry);
        exit = bound(exit, 0, 2e20);
        dt = bound(dt, 0, 30 days);
        address t = address(0x1);
        _open(t, isLong, notional, lev, entry);
        vm.warp(block.timestamp + dt);
        assertEq(m.isLiquidatable(t, exit), m.equity(t, exit) < int256(m.maintenanceMargin(t)));
    }

    function test_noPositionIsInert() public view {
        address t = address(0xdead);
        assertEq(m.equity(t, P0), 0);
        assertEq(m.fundingOwed(t), 0);
        assertFalse(m.isLiquidatable(t, 0));
        assertEq(m.liquidationPrice(t), 0);
    }

    /// Just past liquidationPrice the position is liquidatable; just inside it isn't.
    function testFuzz_liquidationPriceFlip(uint256 notional, uint256 lev, uint256 entry, uint256 dt, bool isLong)
        public
    {
        (notional, lev, entry) = _bounds(notional, lev, entry);
        lev = bound(lev, 2, 50); // at 1x a long's liquidation price is ~1% of entry, still testable
        dt = bound(dt, 0, 7 days);
        address t = address(0x1);
        address other = address(0x2);
        int256 size = _open(t, isLong, notional, lev, entry);
        _open(other, !isLong, notional / 3 + 1, 1, entry); // skew so funding is non-zero
        vm.warp(block.timestamp + dt);

        uint256 liq = m.liquidationPrice(t);
        // a price step worth >= 3 USDC-wei of PnL clears the 1-wei roundings in pnl, funding and the formula
        uint256 eps = 3e30 / _abs(size) + 1;
        if (isLong) {
            vm.assume(liq > eps);
            assertTrue(m.isLiquidatable(t, liq - eps));
            assertFalse(m.isLiquidatable(t, liq + eps));
        } else {
            vm.assume(liq > eps);
            assertFalse(m.isLiquidatable(t, liq - eps));
            assertTrue(m.isLiquidatable(t, liq + eps));
        }
    }

    function test_liquidationPriceKnownValues() public {
        address a = address(0x1);
        address b = address(0x2);
        _open(a, true, 1000e6, 10, 1e18); // buffer = 100 - 10 = 90 USDC on 1000 HBAR
        _open(b, false, 1000e6, 10, 1e18);
        assertEq(m.liquidationPrice(a), 0.91e18);
        assertEq(m.liquidationPrice(b), 1.09e18);
    }

    /*//////////////////////////////////////////////////////////////
                               FUNDING
    //////////////////////////////////////////////////////////////*/

    /// Index grows by factor × skew × dt / (assets × 3600), signed by skew.
    function testFuzz_fundingIndexFormula(uint256 longN, uint256 shortN, uint256 assets, uint256 dt) public {
        longN = bound(longN, 0, 1e12);
        shortN = bound(shortN, 0, 1e12);
        assets = bound(assets, 1, 1e14);
        dt = bound(dt, 0, 365 days);
        m.setPoolAssets(assets);
        if (longN > 0) _open(address(0x1), true, longN, 1, P0);
        if (shortN > 0) _open(address(0x2), false, shortN, 1, P0);
        assertEq(m.longNotional(), longN);
        assertEq(m.shortNotional(), shortN);

        vm.warp(block.timestamp + dt);
        int256 skew = int256(longN) - int256(shortN);
        int256 expected = 1e15 * skew * int256(dt) / (int256(assets) * 3600);
        int256 idx = m.currentFundingIndex();
        assertEq(idx, expected);
        if (skew > 0) assertGe(idx, 0);
        if (skew < 0) assertLe(idx, 0);
        if (skew == 0 || dt == 0) assertEq(idx, 0);

        m.accrue();
        assertEq(m.fundingIndex(), expected);
        assertEq(m.fundingUpdatedAt(), block.timestamp);
    }

    /// Accruing in two steps equals accruing once (up to one wei of truncation per step).
    function testFuzz_fundingAccruesLinearlyInTime(uint256 skewN, uint256 dt1, uint256 dt2) public {
        skewN = bound(skewN, 1e6, 1e12);
        dt1 = bound(dt1, 1, 30 days);
        dt2 = bound(dt2, 1, 30 days);
        _open(address(0x1), true, skewN, 1, P0);

        vm.warp(block.timestamp + dt1 + dt2);
        int256 oneShot = m.currentFundingIndex();
        vm.warp(block.timestamp - dt2);
        m.accrue();
        vm.warp(block.timestamp + dt2);
        assertApproxEqAbs(m.currentFundingIndex(), oneShot, 1);
    }

    /// No pool assets, no funding — and accrual still advances the clock.
    function testFuzz_noFundingWithoutAssets(uint256 longN, uint256 dt) public {
        longN = bound(longN, 1e6, 1e12);
        dt = bound(dt, 1, 365 days);
        m.setPoolAssets(0);
        _open(address(0x1), true, longN, 1, P0);
        vm.warp(block.timestamp + dt);
        assertEq(m.currentFundingIndex(), 0);
        assertEq(m.fundingOwed(address(0x1)), 0);
        m.accrue();
        assertEq(m.fundingIndex(), 0);
        assertEq(m.fundingUpdatedAt(), block.timestamp);
    }

    function test_accrueEmitsRateAndIndex() public {
        _open(address(0x1), true, 1000e6, 1, P0); // skew = 10% of assets → 0.01%/h
        vm.warp(block.timestamp + 3600);
        vm.expectEmit(address(m));
        emit MarginAccount.FundingAccrued(1e14, 1e14);
        m.accrue();
    }

    /// Equal and opposite positions owe equal and opposite funding; the heavy side pays.
    function testFuzz_fundingOwedLongShortOpposite(uint256 n, uint256 extraLong, uint256 dt) public {
        n = bound(n, 1e6, 1e12);
        extraLong = bound(extraLong, 1e6, 1e12);
        dt = bound(dt, 1 hours, 365 days);
        _open(address(0x1), true, n, 1, P0);
        _open(address(0x2), false, n, 1, P0);
        _open(address(0x3), true, extraLong, 1, P0); // longs heavy
        vm.warp(block.timestamp + dt);
        int256 longOwes = m.fundingOwed(address(0x1));
        int256 shortOwes = m.fundingOwed(address(0x2));
        assertEq(longOwes, -shortOwes);
        assertGe(longOwes, 0);
        assertEq(longOwes, m.currentFundingIndex() * int256(n) / 1e18);
    }

    /// A position opened later only owes funding from its own entry index.
    function test_fundingOwedFromEntryIndex() public {
        _open(address(0x1), true, 1000e6, 1, P0);
        vm.warp(block.timestamp + 10 hours);
        _open(address(0x2), true, 1000e6, 1, P0); // accrues first, enters at the new index
        int256 entryIdx = m.positionOf(address(0x2)).fundingIndex;
        assertEq(entryIdx, 1e15); // 10% skew × 10h × 0.1%/h
        assertEq(m.fundingOwed(address(0x2)), 0);
        assertEq(m.fundingOwed(address(0x1)), 1e6); // 1000 USDC × 0.1%
    }

    /*//////////////////////////////////////////////////////////////
                         RUNNING SUMS / BOOK
    //////////////////////////////////////////////////////////////*/

    /// netTraderGain equals Σ(pnl − fundingOwed) over random positions, at a random later price and time.
    function testFuzz_netTraderGainMatchesSum(uint256 seed, uint8 count, uint256 price, uint256 dt) public {
        count = uint8(bound(count, 1, 12));
        price = bound(price, 1e15, 1e20);
        address[] memory ts = new address[](count);
        for (uint256 i; i < count; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            ts[i] = address(uint160(1000 + i));
            uint256 n = bound(r, 1e6, 1e11);
            uint256 entry = bound(r >> 64, 1e15, 1e20);
            _open(ts[i], (r >> 128) & 1 == 0, n, bound(r >> 136, 1, 50), entry);
            vm.warp(block.timestamp + bound(r >> 192, 0, 1 days));
        }
        vm.warp(block.timestamp + bound(dt, 0, 30 days));

        int256 sum;
        for (uint256 i; i < count; i++) {
            sum += m.pnl(ts[i], price) - m.fundingOwed(ts[i]);
        }
        int256 floor = -int256(m.totalCollateral());
        int256 gain = m.netTraderGain(price);
        assertGe(gain, floor);
        if (sum > floor + int256(2 * uint256(count) + 2)) assertApproxEqAbs(gain, sum, 2 * uint256(count) + 2);
        else assertApproxEqAbs(gain, floor, 2 * uint256(count) + 2);
    }

    /// When traders are wiped out, netTraderGain floors at −totalCollateral.
    function test_netTraderGainFloor() public {
        _open(address(0x1), true, 1000e6, 10, 1e18);
        _open(address(0x2), true, 500e6, 5, 1e18);
        assertEq(m.totalCollateral(), 200e6);
        assertEq(m.netTraderGain(0.5e18), -200e6); // raw: −750 USDC
        assertEq(m.netTraderGain(0.9e18), -150e6); // raw, above the floor
    }

    /// Opening and then removing every position returns all running sums to exactly zero.
    function testFuzz_sumsReturnToZero(uint256 seed, uint8 count, uint256 price) public {
        count = uint8(bound(count, 1, 12));
        price = bound(price, 1e15, 1e20);
        address[] memory ts = new address[](count);
        for (uint256 i; i < count; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            ts[i] = address(uint160(1000 + i));
            _open(ts[i], r & 1 == 0, bound(r >> 8, 1e6, 1e11), bound(r >> 72, 1, 50), bound(r >> 80, 1e15, 1e20));
            if ((r >> 160) & 1 == 0) m.addCollateral(ts[i], bound(r >> 168, 1, 1e9));
            vm.warp(block.timestamp + bound(r >> 200, 0, 1 days));
        }
        // remove in a seed-dependent order
        for (uint256 k = count; k > 0; k--) {
            uint256 j = uint256(keccak256(abi.encode(seed, "rm", k))) % k;
            m.remove(ts[j]);
            ts[j] = ts[k - 1];
            vm.warp(block.timestamp + 1 hours);
        }

        (int256 a, int256 b, int256 c, int256 d) = m.sums();
        assertEq(a, 0);
        assertEq(b, 0);
        assertEq(c, 0);
        assertEq(d, 0);
        assertEq(m.netTraderGain(price), 0);
        assertEq(m.totalCollateral(), 0);
        assertEq(m.longNotional(), 0);
        assertEq(m.shortNotional(), 0);
        assertEq(m.traderCount(), 0);
    }

    /// Swap-and-pop keeps `traders` and `_slot` consistent through random removals.
    function testFuzz_tradersArrayIntegrity(uint256 seed, uint8 count, uint8 removals) public {
        count = uint8(bound(count, 1, 20));
        removals = uint8(bound(removals, 0, count));
        address[] memory ts = new address[](count);
        bool[] memory gone = new bool[](count);
        for (uint256 i; i < count; i++) {
            ts[i] = address(uint160(1000 + i));
            _open(ts[i], i % 2 == 0, 100e6, 5, P0);
        }
        for (uint256 k; k < removals; k++) {
            uint256 j = uint256(keccak256(abi.encode(seed, k))) % count;
            while (gone[j]) j = (j + 1) % count;
            gone[j] = true;
            m.remove(ts[j]);
        }

        assertEq(m.traderCount(), count - removals);
        for (uint256 i; i < count; i++) {
            if (gone[i]) {
                assertEq(m.slotOf(ts[i]), 0);
                assertEq(m.positionOf(ts[i]).size, 0);
            } else {
                uint256 slot = m.slotOf(ts[i]);
                assertGt(slot, 0);
                assertEq(m.traders(slot - 1), ts[i]);
                assertTrue(m.positionOf(ts[i]).size != 0);
            }
        }
        // every array entry is a live trader (no duplicates: slots are a bijection)
        for (uint256 s; s < m.traderCount(); s++) {
            assertEq(m.slotOf(m.traders(s)), s + 1);
        }
    }

    /// _addPosition books notional to the right side and the position fields verbatim.
    function testFuzz_addPositionBooksSide(uint256 notional, uint256 lev, uint256 price, bool isLong) public {
        (notional, lev, price) = _bounds(notional, lev, price);
        address t = address(0x1);
        int256 size = _open(t, isLong, notional, lev, price);
        MarginAccount.Position memory p = m.positionOf(t);
        assertEq(p.size, size);
        assertEq(p.collateral, notional / lev);
        assertEq(p.entryPrice, price);
        assertEq(p.entryNotional, notional);
        assertEq(p.openedAt, block.timestamp);
        assertEq(m.longNotional(), isLong ? notional : 0);
        assertEq(m.shortNotional(), isLong ? 0 : notional);
        assertEq(m.totalOpenNotional(), notional);
        assertEq(m.totalCollateral(), notional / lev);
        assertEq(m.netTraderGain(price), 0); // at entry, no funding yet
    }

    /// _addCollateral raises both the position and the total, and moves equity 1:1.
    function testFuzz_addCollateral(uint256 notional, uint256 lev, uint256 amount, uint256 price) public {
        (notional, lev, price) = _bounds(notional, lev, price);
        amount = bound(amount, 0, 1e12);
        address t = address(0x1);
        _open(t, true, notional, lev, price);
        _open(address(0x2), false, 100e6, 2, price);
        uint256 totalBefore = m.totalCollateral();
        int256 eqBefore = m.equity(t, price);
        uint256 liqBefore = m.liquidationPrice(t);

        m.addCollateral(t, amount);
        assertEq(m.positionOf(t).collateral, notional / lev + amount);
        assertEq(m.totalCollateral(), totalBefore + amount);
        assertEq(m.equity(t, price), eqBefore + int256(amount));
        assertLe(m.liquidationPrice(t), liqBefore); // more margin, lower long liquidation price

        m.remove(t);
        assertEq(m.totalCollateral(), 50e6); // only the short's collateral remains
    }
}
