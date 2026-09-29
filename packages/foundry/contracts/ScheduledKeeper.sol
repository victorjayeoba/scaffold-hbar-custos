// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { IHederaScheduleService } from "./interfaces/IHederaScheduleService.sol";
import { HederaResponseCodes } from "hedera-forking/HederaResponseCodes.sol";

/**
 * @title ScheduledKeeper
 * @notice Runs `_work()` every `interval` seconds with no bot: each `tick()` books the next one on the
 *         Hedera Schedule Service (HIP-1215). The contract pays for its own scheduled runs from its HBAR
 *         balance, so keep it funded with `fund()`.
 * @dev A failing `_work()` never breaks the chain: it runs in a self-call and the next tick is booked either way.
 *      If the chain does break (no capacity, empty reserve), anyone can call `revive()` once it is overdue.
 */
abstract contract ScheduledKeeper {
    error ScheduledKeeper__TooEarly(uint256 nextRunAt);
    error ScheduledKeeper__NotOverdue(uint256 overdueAt);
    error ScheduledKeeper__OnlySelf();
    error ScheduledKeeper__Reentrant();
    error ScheduledKeeper__InvalidConfig();

    IHederaScheduleService internal constant HSS = IHederaScheduleService(0x000000000000000000000000000000000000016B);
    int64 internal constant HSS_SUCCESS = int64(int32(HederaResponseCodes.SUCCESS));
    /// @notice How many consecutive seconds `_scheduleNext` tries when a second is full.
    uint256 public constant CAPACITY_PROBES = 10;
    /// @notice Gas held back from `_work()` so booking the next tick always has enough. Measured on testnet:
    ///         `scheduleCall` costs ~1.41M gas whatever gas limit it books, so `gasLimit` must exceed this.
    uint256 public constant SCHEDULE_GAS_RESERVE = 1_500_000;
    /// @notice How early `tick()` is accepted. `block.timestamp` is the start of Hedera's ~2 s block, so a
    ///         schedule that fires exactly at `nextRunAt` can see a timestamp a second or two before it.
    uint256 public constant TIMESTAMP_TOLERANCE = 5;

    uint256 public immutable interval;
    uint256 public immutable gasLimit;

    uint256 public nextRunAt;
    uint256 public lastRunAt;
    address public nextSchedule;
    uint256 public runCount;
    /// @notice Estimated tinybars one scheduled run costs, for `runsLeft()`.
    uint256 public runCostEstimate;

    bool private _ticking;

    event Ticked(uint256 indexed run, bool workOk, bytes reason);
    event TickScheduled(address indexed schedule, uint256 at);
    event ScheduleFailed(int64 responseCode, uint256 at);
    event Revived(address indexed by);
    event Funded(address indexed from, uint256 amount);
    event Stopped(uint256 runs);

    constructor(uint256 interval_, uint256 gasLimit_, uint256 runCostEstimate_) {
        if (interval_ == 0 || gasLimit_ <= SCHEDULE_GAS_RESERVE) revert ScheduledKeeper__InvalidConfig();
        interval = interval_;
        gasLimit = gasLimit_;
        runCostEstimate = runCostEstimate_;
    }

    /// @notice Called by the Schedule Service at `nextRunAt`. Anyone may call it late; calling early reverts
    ///         (more than `TIMESTAMP_TOLERANCE` seconds early).
    function tick() external {
        if (_ticking) revert ScheduledKeeper__Reentrant();
        if (nextRunAt == 0 || block.timestamp + TIMESTAMP_TOLERANCE < nextRunAt) {
            revert ScheduledKeeper__TooEarly(nextRunAt);
        }
        _ticking = true;

        lastRunAt = block.timestamp;
        uint256 run = ++runCount;
        uint256 gas = gasleft();
        if (gas > SCHEDULE_GAS_RESERVE) {
            try this.runWork{ gas: gas - SCHEDULE_GAS_RESERVE }() {
                emit Ticked(run, true, "");
            } catch (bytes memory reason) {
                emit Ticked(run, false, reason);
            }
        } else {
            emit Ticked(run, false, "");
        }

        if (_keepGoing()) {
            _scheduleNext(block.timestamp + interval);
        } else {
            nextRunAt = 0;
            nextSchedule = address(0);
            emit Stopped(run);
        }
        _ticking = false;
    }

    /// @dev Self-call target so a revert in `_work()` is caught and the next tick still gets booked.
    function runWork() external {
        if (msg.sender != address(this)) revert ScheduledKeeper__OnlySelf();
        _work();
    }

    /// @notice Starts the chain, or restarts it when a tick is more than `2 × interval` overdue. Anyone can call.
    function revive() external {
        if (nextRunAt != 0) {
            uint256 overdueAt = nextRunAt + 2 * interval;
            if (block.timestamp <= overdueAt) revert ScheduledKeeper__NotOverdue(overdueAt);
        }
        emit Revived(msg.sender);
        _scheduleNext(block.timestamp + interval);
    }

    /// @notice Tops up the HBAR reserve that pays for scheduled runs.
    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Scheduled runs the current reserve covers, at `runCostEstimate` each.
    function runsLeft() external view returns (uint256) {
        if (runCostEstimate == 0) return type(uint256).max;
        return address(this).balance / runCostEstimate;
    }

    /// @dev Books `tick()` at `at`, or the next second with capacity (up to `CAPACITY_PROBES`).
    ///      On failure `nextRunAt` still moves to `at`, so `revive()` opens after the grace period.
    function _scheduleNext(uint256 at) internal returns (bool) {
        nextRunAt = at;
        nextSchedule = address(0);
        bytes memory callData = abi.encodeCall(this.tick, ());
        for (uint256 i = 0; i < CAPACITY_PROBES; i++) {
            uint256 second = at + i;
            if (!HSS.hasScheduleCapacity(second, gasLimit)) continue;
            (int64 rc, address schedule) = HSS.scheduleCall(address(this), second, gasLimit, 0, callData);
            if (rc != HSS_SUCCESS || schedule == address(0)) {
                emit ScheduleFailed(rc, second);
                return false;
            }
            nextRunAt = second;
            nextSchedule = schedule;
            emit TickScheduled(schedule, second);
            return true;
        }
        emit ScheduleFailed(-1, at);
        return false;
    }

    function _setRunCostEstimate(uint256 tinybars) internal {
        runCostEstimate = tinybars;
    }

    /// @dev The job. Reverting is safe: the tick is still recorded and the next one booked.
    function _work() internal virtual;

    /// @dev Return false to end the chain after this tick. Default: run forever.
    function _keepGoing() internal view virtual returns (bool) {
        return true;
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
