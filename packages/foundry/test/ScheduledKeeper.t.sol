// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { ScheduledKeeper } from "../contracts/ScheduledKeeper.sol";
import { Heartbeat } from "../contracts/examples/Heartbeat.sol";
import { MockHederaScheduleService } from "./mocks/MockHederaScheduleService.sol";

contract FlakyKeeper is ScheduledKeeper {
    bool public fail;
    uint256 public done;

    constructor() ScheduledKeeper(300, 2_000_000, 50) { }

    function setFail(bool value) external {
        fail = value;
    }

    function _work() internal override {
        require(!fail, "work failed");
        done++;
    }
}

contract ScheduledKeeperTest is Test {
    address internal constant HSS_ADDRESS = 0x000000000000000000000000000000000000016B;

    FlakyKeeper internal keeper;

    function setUp() public {
        vm.etch(HSS_ADDRESS, address(new MockHederaScheduleService()).code);
        _hss().setHasCapacity(true);
        _hss().setScheduleResponseCode(int64(22));
        vm.warp(1_000_000);
        keeper = new FlakyKeeper();
    }

    function _hss() internal pure returns (MockHederaScheduleService) {
        return MockHederaScheduleService(HSS_ADDRESS);
    }

    function _start() internal {
        keeper.revive();
    }

    function test_reviveStartsTheChain() public {
        _start();
        assertEq(keeper.nextRunAt(), block.timestamp + 300);
        assertTrue(keeper.nextSchedule() != address(0));
        assertEq(_hss().lastScheduleTo(), address(keeper));
        assertEq(_hss().lastScheduleExpirySecond(), block.timestamp + 300);
        assertEq(_hss().lastScheduleGasLimit(), 2_000_000);
        assertEq(_hss().lastScheduleValue(), 0);
        assertEq(_hss().lastScheduleCallData(), abi.encodeCall(ScheduledKeeper.tick, ()));
    }

    function test_tickBeforeStartReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__TooEarly.selector, 0));
        vm.prank(address(keeper));
        keeper.tick();
    }

    function test_tickEarlyReverts() public {
        _start();
        uint256 at = keeper.nextRunAt();
        vm.warp(at - 6);
        vm.expectRevert(abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__TooEarly.selector, at));
        vm.prank(address(keeper));
        keeper.tick();
    }

    function test_tickAcceptsHederaBlockTimestampLag() public {
        _start();
        vm.warp(keeper.nextRunAt() - 5); // block started up to ~2 s before the schedule fired
        vm.prank(address(keeper));
        keeper.tick();
        assertEq(keeper.runCount(), 1);
    }

    function test_tickRunsWorkAndBooksNext() public {
        _start();
        vm.warp(keeper.nextRunAt());
        vm.expectEmit(true, false, false, true, address(keeper));
        emit ScheduledKeeper.Ticked(1, true, "");
        vm.prank(address(keeper));
        keeper.tick();

        assertEq(keeper.done(), 1);
        assertEq(keeper.runCount(), 1);
        assertEq(keeper.lastRunAt(), block.timestamp);
        assertEq(keeper.nextRunAt(), block.timestamp + 300);
        assertEq(_hss().scheduleCount(), 2);
    }

    function test_tickReschedulesEvenWhenWorkReverts() public {
        _start();
        keeper.setFail(true);
        vm.warp(keeper.nextRunAt());
        vm.expectEmit(true, false, false, true, address(keeper));
        emit ScheduledKeeper.Ticked(1, false, abi.encodeWithSignature("Error(string)", "work failed"));
        vm.prank(address(keeper));
        keeper.tick();

        assertEq(keeper.done(), 0);
        assertEq(keeper.nextRunAt(), block.timestamp + 300);
        assertEq(_hss().scheduleCount(), 2);
    }

    function test_lateTickStillWorksAndIsAnchoredToNow() public {
        _start();
        vm.warp(keeper.nextRunAt() + 1000);
        vm.prank(address(keeper));
        keeper.tick();
        assertEq(keeper.nextRunAt(), block.timestamp + 300);
    }

    function test_secondTickInSameWindowReverts() public {
        _start();
        vm.warp(keeper.nextRunAt());
        vm.prank(address(keeper));
        keeper.tick();
        vm.expectRevert(abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__TooEarly.selector, keeper.nextRunAt()));
        vm.prank(address(keeper));
        keeper.tick();
    }

    function test_capacityProbeMovesToNextFreeSecond() public {
        uint256 at = block.timestamp + 300;
        _hss().setSecondFull(at, true);
        _hss().setSecondFull(at + 1, true);
        _start();
        assertEq(keeper.nextRunAt(), at + 2);
        assertEq(_hss().lastScheduleExpirySecond(), at + 2);
    }

    function test_noCapacityEmitsFailureAndLeavesRevivable() public {
        _hss().setHasCapacity(false);
        uint256 at = block.timestamp + 300;
        vm.expectEmit(false, false, false, true, address(keeper));
        emit ScheduledKeeper.ScheduleFailed(-1, at);
        _start();
        assertEq(keeper.nextSchedule(), address(0));
        assertEq(keeper.nextRunAt(), at);

        _hss().setHasCapacity(true);
        vm.warp(at + 600 + 1);
        keeper.revive();
        assertTrue(keeper.nextSchedule() != address(0));
    }

    function test_scheduleErrorCodeEmitted() public {
        _hss().setScheduleResponseCode(int64(7));
        vm.expectEmit(false, false, false, true, address(keeper));
        emit ScheduledKeeper.ScheduleFailed(7, block.timestamp + 300);
        _start();
        assertEq(keeper.nextSchedule(), address(0));
    }

    function test_reviveOnlyWhenOverdue() public {
        _start();
        uint256 overdueAt = keeper.nextRunAt() + 600;
        vm.warp(overdueAt);
        vm.expectRevert(abi.encodeWithSelector(ScheduledKeeper.ScheduledKeeper__NotOverdue.selector, overdueAt));
        keeper.revive();

        vm.warp(overdueAt + 1);
        vm.expectEmit(true, false, false, false, address(keeper));
        emit ScheduledKeeper.Revived(address(this));
        keeper.revive();
        assertEq(keeper.nextRunAt(), block.timestamp + 300);
    }

    function test_runWorkOnlySelf() public {
        vm.expectRevert(ScheduledKeeper.ScheduledKeeper__OnlySelf.selector);
        keeper.runWork();
    }

    function test_fundAndRunsLeft() public {
        keeper.fund{ value: 5e8 }();
        (bool ok,) = address(keeper).call{ value: 25e7 }("");
        assertTrue(ok);
        assertEq(keeper.runsLeft(), 7); // 7.5e8 / 1e8
    }

    function test_invalidConfigReverts() public {
        vm.expectRevert(ScheduledKeeper.ScheduledKeeper__InvalidConfig.selector);
        new Heartbeat(0, 2_000_000, 0, 0);
        vm.expectRevert(ScheduledKeeper.ScheduledKeeper__InvalidConfig.selector);
        new Heartbeat(60, 1_500_000, 0, 0); // cannot pay for booking its own next tick
    }

    function test_heartbeatStopsAfterMaxBeats() public {
        Heartbeat hb = new Heartbeat(60, 2_000_000, 0, 3);
        hb.revive();
        for (uint256 i = 0; i < 3; i++) {
            vm.warp(hb.nextRunAt());
            vm.prank(address(hb));
            hb.tick();
        }
        assertEq(hb.beats(), 3);
        assertEq(hb.nextRunAt(), 0);
        assertEq(hb.runsLeft(), type(uint256).max);
        // stopped: a new start is allowed
        hb.revive();
        assertEq(hb.nextRunAt(), block.timestamp + 60);
    }
}
