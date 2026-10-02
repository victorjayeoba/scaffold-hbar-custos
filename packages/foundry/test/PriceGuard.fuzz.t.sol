// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";
import { MockAggregator } from "./mocks/MockAggregator.sol";
import { MockSupra } from "./mocks/MockSupra.sol";

/// @dev A Supra feed that reverts, which MockSupra can't do.
contract RevertingSupra {
    function getSvalue(uint256) external pure returns (uint256, uint256, uint256, uint256) {
        revert("supra down");
    }
}

/// @dev Supra feed with a raw millisecond timestamp, for sub-second boundaries.
contract RawSupra {
    uint256 public decimals;
    uint256 public price;
    uint256 public timeMs;

    function set(uint256 decimals_, uint256 price_, uint256 timeMs_) external {
        decimals = decimals_;
        price = price_;
        timeMs = timeMs_;
    }

    function getSvalue(uint256) external view returns (uint256, uint256, uint256, uint256) {
        return (1, decimals, timeMs, price);
    }
}

contract PriceGuardFuzzTest is Test {
    uint256 internal constant T0 = 1_000_000;
    uint256 internal constant STALENESS = 3600;
    uint256 internal constant DEV_BPS = 300;

    MockAggregator internal chainlink;
    MockSupra internal supra;
    PriceGuard internal guard;

    event ParamsSet(uint256 maxStaleness, uint256 maxDeviationBps);

    function setUp() public {
        vm.warp(T0);
        chainlink = new MockAggregator(8, 12_000_000);
        supra = new MockSupra(8, 12_000_000);
        guard = new PriceGuard(address(chainlink), address(supra), 75, STALENESS, DEV_BPS, address(this));
    }

    function _status(PriceGuard g) internal view returns (uint256) {
        return uint256(g.status());
    }

    function _expectNotOk(PriceGuard g, PriceGuard.Status s) internal {
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PriceGuard__NotOk.selector, s));
        g.price();
    }

    /*//////////////////////////////////////////////////////////////
                               SCALING
    //////////////////////////////////////////////////////////////*/

    /// The same real price expressed at any Chainlink/Supra decimals reads identically and is Ok.
    function testFuzz_samePriceAnyDecimalsIsOk(uint8 clDec, uint256 supraDec, uint256 whole) public {
        clDec = uint8(bound(clDec, 0, 18));
        supraDec = bound(supraDec, 0, 36);
        whole = bound(whole, 1, 1e12); // integer USD price, representable at every decimals
        MockAggregator cl = new MockAggregator(clDec, int256(whole * 10 ** clDec));
        MockSupra sp = new MockSupra(supraDec, whole * 10 ** supraDec);
        PriceGuard g = new PriceGuard(address(cl), address(sp), 1, STALENESS, DEV_BPS, address(this));

        (uint256 p, PriceGuard.Status s,,, uint256 dev) = g.read();
        assertEq(p, whole * 1e18);
        assertEq(dev, 0);
        assertEq(uint256(s), uint256(PriceGuard.Status.Ok));
        assertEq(g.price(), whole * 1e18);
        (uint256 clP, uint256 spP,) = g.prices();
        assertEq(clP, whole * 1e18);
        assertEq(spP, whole * 1e18);
    }

    /// Chainlink answers are scaled exactly by 10^(18 - decimals).
    function testFuzz_chainlinkScaling(uint8 clDec, uint256 answer) public {
        clDec = uint8(bound(clDec, 0, 18));
        answer = bound(answer, 1, 1e40);
        MockAggregator cl = new MockAggregator(clDec, int256(answer));
        PriceGuard g = new PriceGuard(address(cl), address(supra), 75, STALENESS, DEV_BPS, address(this));
        (uint256 p,,,,) = g.read();
        assertEq(p, answer * 10 ** (18 - clDec));
    }

    /// Supra above 18 decimals scales down (truncating); a price that truncates to 0 reads Stale.
    function testFuzz_supraAbove18DecimalsScalesDown(uint256 supraDec, uint256 raw) public {
        supraDec = bound(supraDec, 19, 36);
        raw = bound(raw, 1, 1e60);
        RawSupra sp = new RawSupra();
        sp.set(supraDec, raw, block.timestamp * 1000);
        PriceGuard g = new PriceGuard(address(chainlink), address(sp), 75, STALENESS, DEV_BPS, address(this));
        (, uint256 spP, PriceGuard.Status s) = g.prices();
        assertEq(spP, raw / 10 ** (supraDec - 18));
        if (spP == 0) assertEq(uint256(s), uint256(PriceGuard.Status.Stale));
        else assertTrue(s != PriceGuard.Status.Stale);
    }

    /// Supra decimals over 36 are rejected as unavailable.
    function testFuzz_supraDecimalsOver36IsStale(uint256 supraDec) public {
        supraDec = bound(supraDec, 37, 1000);
        RawSupra sp = new RawSupra();
        sp.set(supraDec, 1e40, block.timestamp * 1000);
        PriceGuard g = new PriceGuard(address(chainlink), address(sp), 75, STALENESS, DEV_BPS, address(this));
        (, uint256 spP, PriceGuard.Status s) = g.prices();
        assertEq(spP, 0);
        assertEq(uint256(s), uint256(PriceGuard.Status.Stale));
    }

    /*//////////////////////////////////////////////////////////////
                              STALENESS
    //////////////////////////////////////////////////////////////*/

    /// Fresh iff age <= maxStaleness, for either feed, for any configured window.
    function testFuzz_stalenessBoundary(uint256 window, uint256 age, bool ageChainlink) public {
        window = bound(window, 1, guard.MAX_STALENESS_LIMIT());
        age = bound(age, 0, 2 days);
        guard.setParams(window, DEV_BPS);
        if (ageChainlink) chainlink.set(12_000_000, block.timestamp - age);
        else supra.set(12_000_000, block.timestamp - age);
        uint256 expected = age > window ? uint256(PriceGuard.Status.Stale) : uint256(PriceGuard.Status.Ok);
        assertEq(_status(guard), expected);
    }

    function test_stalenessExactAndPlusOne() public {
        chainlink.set(12_000_000, block.timestamp - STALENESS);
        supra.set(12_000_000, block.timestamp - STALENESS);
        assertEq(_status(guard), uint256(PriceGuard.Status.Ok));
        vm.warp(block.timestamp + 1);
        assertEq(_status(guard), uint256(PriceGuard.Status.Stale));
        _expectNotOk(guard, PriceGuard.Status.Stale);
    }

    /// Supra's millisecond timestamp is floored to seconds: 999 ms past the edge still counts as the edge.
    function test_supraMillisecondsFloored() public {
        RawSupra sp = new RawSupra();
        PriceGuard g = new PriceGuard(address(chainlink), address(sp), 75, STALENESS, DEV_BPS, address(this));
        sp.set(8, 12_000_000, (block.timestamp - STALENESS) * 1000 + 999);
        assertEq(_status(g), uint256(PriceGuard.Status.Ok));
        sp.set(8, 12_000_000, (block.timestamp - STALENESS - 1) * 1000 + 999);
        assertEq(_status(g), uint256(PriceGuard.Status.Stale));
        (,,, uint256 spAt,) = g.read();
        assertEq(spAt, block.timestamp - STALENESS - 1);
    }

    /// A feed timestamp in the future is never stale.
    function testFuzz_futureTimestampNeverStale(uint256 ahead, uint256 ahead2) public {
        ahead = bound(ahead, 1, 365 days);
        ahead2 = bound(ahead2, 0, 365 days);
        chainlink.set(12_000_000, block.timestamp + ahead);
        supra.set(12_000_000, block.timestamp + ahead2);
        assertEq(_status(guard), uint256(PriceGuard.Status.Ok));
        (,, uint256 clAt, uint256 spAt,) = guard.read();
        assertEq(clAt, block.timestamp + ahead);
        assertEq(spAt, block.timestamp + ahead2);
    }

    /// A zero timestamp is always stale, even right after genesis.
    function test_zeroTimestampIsStale() public {
        vm.warp(1);
        chainlink.set(12_000_000, 1);
        supra.set(12_000_000, 0);
        assertEq(_status(guard), uint256(PriceGuard.Status.Stale));
    }

    /*//////////////////////////////////////////////////////////////
                              DEVIATION
    //////////////////////////////////////////////////////////////*/

    /// Exactly maxDeviationBps apart is Ok (above or below); one more bps is Deviated.
    function testFuzz_deviationBoundary(uint256 m, uint256 maxDev, bool above) public {
        m = bound(m, 1, 1e20);
        maxDev = bound(maxDev, 1, guard.MAX_DEVIATION_LIMIT_BPS());
        guard.setParams(STALENESS, maxDev);
        uint256 cl = m * 10_000;
        chainlink.set(int256(cl), block.timestamp);

        supra.set(above ? cl + m * maxDev : cl - m * maxDev, block.timestamp);
        (, PriceGuard.Status s,,, uint256 dev) = guard.read();
        assertEq(dev, maxDev);
        assertEq(uint256(s), uint256(PriceGuard.Status.Ok));

        supra.set(above ? cl + m * (maxDev + 1) : cl - m * (maxDev + 1), block.timestamp);
        (, s,,, dev) = guard.read();
        assertEq(dev, maxDev + 1);
        assertEq(uint256(s), uint256(PriceGuard.Status.Deviated));
        _expectNotOk(guard, PriceGuard.Status.Deviated);
    }

    /// Deviation is measured against Chainlink's price and truncates.
    function testFuzz_deviationFormula(uint256 cl, uint256 sp) public {
        cl = bound(cl, 1, 1e30);
        sp = bound(sp, 1, 1e30);
        chainlink.set(int256(cl), block.timestamp);
        supra.set(sp, block.timestamp);
        (, PriceGuard.Status s,,, uint256 dev) = guard.read();
        uint256 diff = cl > sp ? cl - sp : sp - cl;
        assertEq(dev, diff * 10_000 / cl);
        assertEq(uint256(s), dev > DEV_BPS ? uint256(PriceGuard.Status.Deviated) : uint256(PriceGuard.Status.Ok));
    }

    /// Stale wins over Deviated.
    function test_staleTakesPrecedenceOverDeviated() public {
        supra.set(24_000_000, block.timestamp); // 100% off
        assertEq(_status(guard), uint256(PriceGuard.Status.Deviated));
        chainlink.set(12_000_000, block.timestamp - STALENESS - 1);
        assertEq(_status(guard), uint256(PriceGuard.Status.Stale));
    }

    /*//////////////////////////////////////////////////////////////
                           UNAVAILABLE FEEDS
    //////////////////////////////////////////////////////////////*/

    /// Any non-positive Chainlink answer reads as unavailable: price 0, Stale, price() reverts.
    function testFuzz_nonPositiveChainlinkIsStale(int256 answer) public {
        answer = bound(answer, type(int256).min, 0);
        chainlink.set(answer, block.timestamp);
        (uint256 p, PriceGuard.Status s, uint256 clAt,, uint256 dev) = guard.read();
        assertEq(p, 0);
        assertEq(clAt, 0);
        assertEq(dev, 0);
        assertEq(uint256(s), uint256(PriceGuard.Status.Stale));
        _expectNotOk(guard, PriceGuard.Status.Stale);
    }

    function test_zeroSupraIsStale() public {
        supra.set(0, block.timestamp);
        (uint256 clP, uint256 spP, PriceGuard.Status s) = guard.prices();
        assertEq(clP, 0.12e18); // Chainlink still reported
        assertEq(spP, 0);
        assertEq(uint256(s), uint256(PriceGuard.Status.Stale));
        _expectNotOk(guard, PriceGuard.Status.Stale);
    }

    function test_revertingSupraIsStale() public {
        RevertingSupra sp = new RevertingSupra();
        PriceGuard g = new PriceGuard(address(chainlink), address(sp), 75, STALENESS, DEV_BPS, address(this));
        (uint256 p, PriceGuard.Status s,, uint256 spAt,) = g.read();
        assertEq(p, 0.12e18);
        assertEq(spAt, 0);
        assertEq(uint256(s), uint256(PriceGuard.Status.Stale));
        _expectNotOk(g, PriceGuard.Status.Stale);
    }

    function test_revertingChainlinkIsStale() public {
        chainlink.setBroken(true);
        (uint256 clP, uint256 spP, PriceGuard.Status s) = guard.prices();
        assertEq(clP, 0);
        assertEq(spP, 0.12e18);
        assertEq(uint256(s), uint256(PriceGuard.Status.Stale));
        _expectNotOk(guard, PriceGuard.Status.Stale);
    }

    /*//////////////////////////////////////////////////////////////
                          VIEW CONSISTENCY
    //////////////////////////////////////////////////////////////*/

    /// read(), prices(), status() and price() agree for any feed state within sane ranges.
    function testFuzz_viewsAgree(int256 clAns, uint256 spAns, uint256 clAge, uint256 spAge, bool broken) public {
        clAns = bound(clAns, -1e20, 1e20);
        spAns = bound(spAns, 0, 1e20);
        clAge = bound(clAge, 0, 2 * STALENESS);
        spAge = bound(spAge, 0, 2 * STALENESS);
        chainlink.set(clAns, block.timestamp - clAge);
        supra.set(spAns, block.timestamp - spAge);
        chainlink.setBroken(broken);

        (uint256 p, PriceGuard.Status s,,,) = guard.read();
        (uint256 clP,, PriceGuard.Status s2) = guard.prices();
        assertEq(clP, p);
        assertEq(uint256(s2), uint256(s));
        assertEq(uint256(guard.status()), uint256(s));
        if (s == PriceGuard.Status.Ok) {
            assertEq(guard.price(), p);
            assertGt(p, 0);
        } else {
            _expectNotOk(guard, s);
        }
    }

    /// A feed value too large to scale reads as unavailable (Stale) instead of reverting prices()/read().
    /// Regression: the overflow used to happen inside the try's success block, which catch does not cover.
    function test_pricesNeverRevertOnOverflowingFeed() public {
        MockAggregator cl = new MockAggregator(0, type(int256).max); // answer * 1e18 overflows
        PriceGuard g = new PriceGuard(address(cl), address(supra), 75, STALENESS, DEV_BPS, address(this));
        (uint256 p, uint256 sp, PriceGuard.Status s) = g.prices();
        assertEq(p, 0);
        assertEq(sp, 0.12e18);
        assertEq(uint256(s), uint256(PriceGuard.Status.Stale));
    }

    /*//////////////////////////////////////////////////////////////
                               CONFIG
    //////////////////////////////////////////////////////////////*/

    /// setParams accepts exactly 0 < staleness <= 1 day and 0 < deviation <= 2000 bps.
    function testFuzz_setParamsBounds(uint256 staleness, uint256 dev) public {
        staleness = bound(staleness, 0, 2 days);
        dev = bound(dev, 0, 4000);
        bool valid = staleness > 0 && staleness <= 1 days && dev > 0 && dev <= 2000;
        if (valid) {
            vm.expectEmit(address(guard));
            emit ParamsSet(staleness, dev);
            guard.setParams(staleness, dev);
            assertEq(guard.maxStaleness(), staleness);
            assertEq(guard.maxDeviationBps(), dev);
        } else {
            vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
            guard.setParams(staleness, dev);
            assertEq(guard.maxStaleness(), STALENESS);
            assertEq(guard.maxDeviationBps(), DEV_BPS);
        }
    }

    function test_setParamsLimitsInclusive() public {
        guard.setParams(guard.MAX_STALENESS_LIMIT(), guard.MAX_DEVIATION_LIMIT_BPS());
        assertEq(guard.maxStaleness(), 1 days);
        assertEq(guard.maxDeviationBps(), 2000);
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        guard.setParams(1 days + 1, 2000);
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        guard.setParams(1 days, 2001);
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        guard.setParams(1 days, 0);
    }

    function testFuzz_setParamsOnlyOwner(address caller) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, caller));
        guard.setParams(60, 100);
    }

    function testFuzz_constructorRejectsDecimalsOver18(uint8 dec) public {
        dec = uint8(bound(dec, 19, 255));
        MockAggregator cl = new MockAggregator(dec, 1);
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        new PriceGuard(address(cl), address(supra), 75, STALENESS, DEV_BPS, address(this));
    }

    function test_constructorRejectsZeroAddressesAndBadParams() public {
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        new PriceGuard(address(chainlink), address(0), 75, STALENESS, DEV_BPS, address(this));
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        new PriceGuard(address(chainlink), address(supra), 75, 0, DEV_BPS, address(this));
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        new PriceGuard(address(chainlink), address(supra), 75, STALENESS, 2001, address(this));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PriceGuard(address(chainlink), address(supra), 75, STALENESS, DEV_BPS, address(0));
    }

    function test_constructorEmitsParamsSetAndStoresConfig() public {
        vm.expectEmit();
        emit ParamsSet(120, 50);
        PriceGuard g = new PriceGuard(address(chainlink), address(supra), 42, 120, 50, address(0xA11CE));
        assertEq(address(g.chainlink()), address(chainlink));
        assertEq(address(g.supra()), address(supra));
        assertEq(g.supraPair(), 42);
        assertEq(g.owner(), address(0xA11CE));
    }
}
