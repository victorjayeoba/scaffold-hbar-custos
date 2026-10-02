// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { ScheduledKeeper } from "../contracts/ScheduledKeeper.sol";
import { Heartbeat } from "../contracts/examples/Heartbeat.sol";
import { MockHederaScheduleService } from "./mocks/MockHederaScheduleService.sol";

/// @dev Work that reverts with a custom payload on demand.
contract RevertingKeeper is ScheduledKeeper {
    error Boom(uint256 code);

    constructor() ScheduledKeeper(300, 2_000_000, 50) { }

    function _work() internal pure override {
        revert Boom(42);
    }
}

/// @dev Work that burns every unit of gas it is given.
contract GasHogKeeper is ScheduledKeeper {
    uint256 public sink;

    constructor() ScheduledKeeper(300, 2_000_000, 0) { }

    function _work() internal override {
        while (true) {
            sink++;
        }
    }
}

/// @dev Malicious work that re-enters tick() as the contract itself.
contract ReentrantKeeper is ScheduledKeeper {
    constructor() ScheduledKeeper(300, 2_000_000, 0) { }

    function _work() internal override {
        this.tick();
    }
}

contract ScheduledKeeperEdgeTest is Test {
    address internal constant HSS_ADDRESS = 0x000000000000000000000000000000000000016B;
    uint256 internal constant INTERVAL = 60;
    uint256 internal constant GAS = 2_000_000;

    Heartbeat internal hb;

    function setUp() public {
        vm.etch(HSS_ADDRESS, address(new MockHederaScheduleService()).code);
        _hss().setHasCapacity(true);
        _hss().setScheduleResponseCode(int64(22));
        vm.warp(1_000_000);
        hb = new Heartbeat(INTERVAL, GAS, 50, 0); // 2M gas x 50 tinybars: a run holds 1 HBAR
    }

    function _hss() internal pure returns (MockHederaScheduleService) {
        return MockHederaScheduleService(HSS_ADDRESS);
    }

    function _netTick(ScheduledKeeper k) internal {
        vm.prank(address(k));
        k.tick();
    }

    // ---------------------------------------------------------------- access

    function testFuzz_tickRejectsAnyoneButTheContract(address caller) public {
        if (caller == address(hb)) caller = address(1);
        hb.revive();
        vm.warp(hb.nextRunAt());
        vm.prank(caller);
        vm.expectRevert(ScheduledKeeper.ScheduledKeeper__OnlyNetwork.selector);
        hb.tick();
    }

    function testFuzz_runWorkRejectsAnyoneButTheContract(address caller) public {
        if (caller == address(hb)) caller = address(1);
        vm.prank(caller);
        vm.expectRevert(ScheduledKeeper.ScheduledKeeper__OnlySelf.selector);
        hb.runWork();
    }

    // ---------------------------------------------------------------- timing window

    function testFuzz_tickAcceptedFromToleranceOnward(uint256 t) public {
        hb.revive();
        uint256 at = hb.nextRunAt();
        t = bound(t, at - 5, at + 365 days);
        vm.warp(t);
        _netTick(hb);
        assertEq(hb.runCount(), 1);
        assertEq(hb.lastRunAt(), t);
        assertEq(hb.nextRunAt(), t + INTERVAL);
    }

    function testFuzz_tickBeforeToleranceReverts(uint256 t) public {
        hb.revive();
        uint256 at = hb.nextRunAt();
        t = bound(t, block.timestamp, at - 6);
        vm.warp(t);
        vm.expectRevert(abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__TooEarly.selector, at));
        _netTick(hb);
    }

    // ---------------------------------------------------------------- capacity probing

    function testFuzz_capacityProbeBooksFirstFreeSecond(uint256 k) public {
        k = bound(k, 0, 9);
        uint256 at = block.timestamp + INTERVAL;
        for (uint256 i = 0; i < k; i++) {
            _hss().setSecondFull(at + i, true);
        }
        vm.expectEmit(false, false, false, true, address(hb));
        emit ScheduledKeeper.TickScheduled(address(0), at + k);
        hb.revive();
        assertEq(hb.nextRunAt(), at + k);
        assertEq(_hss().lastScheduleExpirySecond(), at + k);
        assertTrue(hb.nextSchedule() != address(0));
    }

    function testFuzz_capacityProbeOnTickPath(uint256 k) public {
        k = bound(k, 0, 9);
        hb.revive();
        vm.warp(hb.nextRunAt());
        uint256 at = block.timestamp + INTERVAL;
        for (uint256 i = 0; i < k; i++) {
            _hss().setSecondFull(at + i, true);
        }
        _netTick(hb);
        assertEq(hb.nextRunAt(), at + k);
        // the probed tick is still accepted at its shifted time
        vm.warp(at + k);
        _netTick(hb);
        assertEq(hb.runCount(), 2);
    }

    function test_allTenProbesFullFailsAndOpensRevive() public {
        uint256 at = block.timestamp + INTERVAL;
        for (uint256 i = 0; i < 10; i++) {
            _hss().setSecondFull(at + i, true);
        }
        vm.expectEmit(false, false, false, true, address(hb));
        emit ScheduledKeeper.ScheduleFailed(-1, at);
        hb.revive();
        assertEq(hb.nextSchedule(), address(0));
        assertEq(hb.nextRunAt(), at);
        assertEq(_hss().scheduleCount(), 0);

        uint256 overdueAt = at + 2 * INTERVAL;
        vm.warp(overdueAt);
        vm.expectRevert(abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__NotOverdue.selector, overdueAt));
        hb.revive();
        vm.warp(overdueAt + 1);
        hb.revive();
        assertEq(hb.nextRunAt(), overdueAt + 1 + INTERVAL);
        assertTrue(hb.nextSchedule() != address(0));
    }

    function test_eleventhSecondFreeIsNotProbed() public {
        uint256 at = block.timestamp + INTERVAL;
        for (uint256 i = 0; i < 10; i++) {
            _hss().setSecondFull(at + i, true);
        }
        hb.revive(); // at + 10 is free, but only 10 probes are made
        assertEq(hb.nextSchedule(), address(0));
        assertEq(hb.nextRunAt(), at);
    }

    // ---------------------------------------------------------------- HSS errors

    function testFuzz_hssErrorCodeEmittedAndRecoverable(int64 rc, uint256 k) public {
        if (rc == 22) rc = 23;
        k = bound(k, 0, 9);
        uint256 at = block.timestamp + INTERVAL;
        for (uint256 i = 0; i < k; i++) {
            _hss().setSecondFull(at + i, true);
        }
        _hss().setScheduleResponseCode(rc);
        vm.expectEmit(false, false, false, true, address(hb));
        emit ScheduledKeeper.ScheduleFailed(rc, at + k);
        hb.revive();
        assertEq(hb.nextSchedule(), address(0));
        assertEq(hb.nextRunAt(), at); // not the probed second: grace counts from the target
        assertEq(_hss().scheduleCount(), 1); // no retry after a hard error

        _hss().setScheduleResponseCode(22);
        vm.warp(at + 2 * INTERVAL + 1);
        hb.revive();
        assertTrue(hb.nextSchedule() != address(0));
    }

    function test_hssErrorDuringTickStillRecordsRun() public {
        hb.revive();
        vm.warp(hb.nextRunAt());
        _hss().setScheduleResponseCode(21);
        _netTick(hb);
        assertEq(hb.runCount(), 1);
        assertEq(hb.beats(), 1);
        assertEq(hb.nextSchedule(), address(0));
        assertEq(hb.nextRunAt(), block.timestamp + INTERVAL);
    }

    // ---------------------------------------------------------------- revive

    function testFuzz_reviveBoundary(uint256 t) public {
        hb.revive();
        uint256 overdueAt = hb.nextRunAt() + 2 * INTERVAL;
        t = bound(t, block.timestamp, overdueAt + 365 days);
        vm.warp(t);
        if (t <= overdueAt) {
            vm.expectRevert(abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__NotOverdue.selector, overdueAt));
            hb.revive();
        } else {
            hb.revive();
            assertEq(hb.nextRunAt(), t + INTERVAL);
        }
    }

    function testFuzz_reviveEmitsCallerAndBooks(address caller) public {
        vm.expectEmit(true, false, false, false, address(hb));
        emit ScheduledKeeper.Revived(caller);
        vm.prank(caller);
        hb.revive();
        assertEq(hb.nextRunAt(), block.timestamp + INTERVAL);
        assertEq(_hss().lastScheduleTo(), address(hb));
    }

    function test_scheduledCallIsExactlyTick() public {
        hb.revive();
        assertEq(_hss().lastScheduleTo(), address(hb));
        assertEq(_hss().lastScheduleGasLimit(), GAS);
        assertEq(_hss().lastScheduleValue(), 0);
        assertEq(_hss().lastScheduleCallData(), abi.encodeCall(ScheduledKeeper.tick, ()));
        // every reschedule books the same call
        vm.warp(hb.nextRunAt());
        _netTick(hb);
        assertEq(_hss().lastScheduleCallData(), abi.encodeCall(ScheduledKeeper.tick, ()));
        assertEq(_hss().lastScheduleGasLimit(), GAS);
        assertEq(_hss().lastScheduleValue(), 0);
    }

    // ---------------------------------------------------------------- failing / hostile work

    function test_revertingWorkEmitsReasonAndBooks() public {
        RevertingKeeper k = new RevertingKeeper();
        k.revive();
        vm.warp(k.nextRunAt());
        vm.expectEmit(true, false, false, true, address(k));
        emit ScheduledKeeper.Ticked(1, false, abi.encodeWithSelector(RevertingKeeper.Boom.selector, 42));
        _netTick(k);
        assertEq(k.runCount(), 1);
        assertEq(k.nextRunAt(), block.timestamp + 300);
        assertTrue(k.nextSchedule() != address(0));
    }

    function test_gasHogWorkStillReschedules() public {
        GasHogKeeper k = new GasHogKeeper();
        k.revive();
        vm.warp(k.nextRunAt());
        vm.expectEmit(true, false, false, true, address(k));
        emit ScheduledKeeper.Ticked(1, false, "");
        vm.prank(address(k));
        k.tick{ gas: GAS }();
        assertEq(k.runCount(), 1);
        assertEq(k.nextRunAt(), block.timestamp + 300);
        assertEq(_hss().scheduleCount(), 2);
    }

    function test_tickBelowReserveSkipsWorkButBooks() public {
        hb.revive();
        vm.warp(hb.nextRunAt());
        vm.expectEmit(true, false, false, true, address(hb));
        emit ScheduledKeeper.Ticked(1, false, "");
        vm.prank(address(hb));
        hb.tick{ gas: 1_000_000 }();
        assertEq(hb.beats(), 0); // work skipped
        assertEq(hb.runCount(), 1);
        assertEq(hb.nextRunAt(), block.timestamp + INTERVAL);
    }

    function test_reentrantTickFromWorkRejected() public {
        ReentrantKeeper k = new ReentrantKeeper();
        k.revive();
        vm.warp(k.nextRunAt());
        vm.expectEmit(true, false, false, true, address(k));
        emit ScheduledKeeper.Ticked(
            1, false, abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__Reentrant.selector)
        );
        _netTick(k);
        assertEq(k.runCount(), 1);
        assertEq(k.nextRunAt(), block.timestamp + 300);
        assertEq(_hss().scheduleCount(), 2);
        // the guard resets: the next network tick works
        vm.warp(k.nextRunAt());
        _netTick(k);
        assertEq(k.runCount(), 2);
    }

    // ---------------------------------------------------------------- progression

    function testFuzz_runCountAndLastRunAtProgress(uint256 n, uint256 lateness) public {
        n = bound(n, 1, 40);
        hb.revive();
        for (uint256 i = 1; i <= n; i++) {
            uint256 t = hb.nextRunAt() + bound(uint256(keccak256(abi.encode(lateness, i))), 0, 1000);
            vm.warp(t);
            _netTick(hb);
            assertEq(hb.runCount(), i);
            assertEq(hb.beats(), i);
            assertEq(hb.lastRunAt(), t);
            assertEq(hb.nextRunAt(), t + INTERVAL);
        }
        assertEq(_hss().scheduleCount(), n + 1);
    }

    function test_maxBeatsZeroRunsForever() public {
        hb.revive();
        for (uint256 i = 0; i < 100; i++) {
            vm.warp(hb.nextRunAt());
            _netTick(hb);
        }
        assertEq(hb.beats(), 100);
        assertTrue(hb.nextRunAt() != 0);
        assertTrue(hb.nextSchedule() != address(0));
    }

    function testFuzz_heartbeatStopsAtMaxBeats(uint256 maxBeats) public {
        maxBeats = bound(maxBeats, 1, 20);
        Heartbeat h = new Heartbeat(INTERVAL, GAS, 0, maxBeats);
        h.revive();
        for (uint256 i = 1; i < maxBeats; i++) {
            vm.warp(h.nextRunAt());
            _netTick(h);
            assertTrue(h.nextRunAt() != 0);
        }
        vm.warp(h.nextRunAt());
        vm.expectEmit(false, false, false, true, address(h));
        emit ScheduledKeeper.Stopped(maxBeats);
        _netTick(h);
        assertEq(h.beats(), maxBeats);
        assertEq(h.nextRunAt(), 0);
        assertEq(h.nextSchedule(), address(0));

        // stopped: no network tick is accepted
        vm.expectRevert(abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__TooEarly.selector, 0));
        _netTick(h);

        // revivable immediately; runCount already >= maxBeats, so it beats exactly once more then stops
        h.revive();
        vm.warp(h.nextRunAt());
        _netTick(h);
        assertEq(h.beats(), maxBeats + 1);
        assertEq(h.nextRunAt(), 0);
    }

    // ---------------------------------------------------------------- config

    function test_constructorBoundaries() public {
        vm.expectRevert(ScheduledKeeper.ScheduledKeeper__InvalidConfig.selector);
        new Heartbeat(0, GAS, 0, 0);
        vm.expectRevert(ScheduledKeeper.ScheduledKeeper__InvalidConfig.selector);
        new Heartbeat(1, 1_600_000, 0, 0);
        Heartbeat ok = new Heartbeat(1, 1_600_001, 0, 0);
        assertEq(ok.gasLimit(), 1_600_001);
        assertEq(ok.interval(), 1);
    }

    function testFuzz_constructorRejectsLowGas(uint256 gasLimit, uint256 interval) public {
        gasLimit = bound(gasLimit, 0, 1_600_000);
        interval = bound(interval, 1, type(uint64).max);
        vm.expectRevert(ScheduledKeeper.ScheduledKeeper__InvalidConfig.selector);
        new Heartbeat(interval, gasLimit, 0, 0);
    }

    // ---------------------------------------------------------------- funding

    function testFuzz_runsLeft(uint256 balance, uint256 price) public {
        balance = bound(balance, 0, 1e30);
        price = bound(price, 0, 1_000_000);
        Heartbeat h = new Heartbeat(INTERVAL, GAS, price, 0);
        vm.deal(address(h), balance);
        assertEq(h.runCostEstimate(), GAS * price);
        assertEq(h.runsLeft(), price == 0 ? type(uint256).max : balance / (GAS * price));
        assertEq(h.canPayNextRun(), balance >= GAS * price);
    }

    function testFuzz_fundAndReceiveEmitFunded(address from, uint256 a, uint256 b) public {
        from = address(uint160(bound(uint160(from), 0x10000, type(uint160).max)));
        if (from == address(hb) || from == address(vm)) from = address(0xBEEF0);
        a = bound(a, 0, 1e24);
        b = bound(b, 0, 1e24);
        vm.deal(from, a + b);

        vm.expectEmit(true, false, false, true, address(hb));
        emit ScheduledKeeper.Funded(from, a);
        vm.prank(from);
        hb.fund{ value: a }();

        vm.expectEmit(true, false, false, true, address(hb));
        emit ScheduledKeeper.Funded(from, b);
        vm.prank(from);
        (bool ok,) = address(hb).call{ value: b }("");
        assertTrue(ok);
        assertEq(address(hb).balance, a + b);
    }

    function test_unknownCalldataWithValueReverts() public {
        (bool ok,) = address(hb).call{ value: 1 }(hex"deadbeef");
        assertFalse(ok); // no fallback: only fund() and plain transfers top up
    }
}
