// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { IHederaScheduleService } from "./interfaces/IHederaScheduleService.sol";
import { HederaResponseCodes } from "hedera-forking/HederaResponseCodes.sol";

/**
 * @title ScheduledKeeper
 * @notice Runs `_work()` every `interval` seconds with no bot: each `tick()` books the next one on the
 *         Hedera Schedule Service (HIP-1215). The contract pays for its own scheduled runs from its HBAR
 *         balance, so keep it funded with `fund()`.
 *         Hedera will only start a scheduled run if the payer holds the run's whole gas limit at the current gas
 *         price (verified on testnet: a 5M-gas run failed INSUFFICIENT_PAYER_BALANCE with 3.6 HBAR at 82 tinybar
 *         per gas). So one run costs up to `gasLimit × gasPrice`, and that is what `runsLeft()` counts.
 * @dev Only the network can tick. When the Schedule Service executes a call the contract booked, `msg.sender`
 *      (and `tx.origin`) is the contract itself (verified on Hedera testnet), so `tick()` accepts nothing else.
 *      Nobody can tick early, skip work, or make a booked run revert.
 *      A failing `_work()` never breaks the chain: it runs in a self-call and the next tick is booked either way.
 *      If the chain does break (no capacity, empty reserve), anyone can call `revive()` once it is overdue.
 */
abstract contract ScheduledKeeper {
    error ScheduledKeeper__TooEarly(uint256 nextRunAt);
    error ScheduledKeeper__OnlyNetwork();
    error ScheduledKeeper__NotOverdue(uint256 overdueAt);
    error ScheduledKeeper__OnlySelf();
    error ScheduledKeeper__Reentrant();
    error ScheduledKeeper__InvalidConfig();

    IHederaScheduleService internal constant HSS = IHederaScheduleService(0x000000000000000000000000000000000000016B);
    int64 internal constant HSS_SUCCESS = int64(int32(HederaResponseCodes.SUCCESS));
    /// @notice How many consecutive seconds `_scheduleNext` tries when a second is full.
    uint256 public constant CAPACITY_PROBES = 10;
    /// @notice Gas held back from `_work()` so booking the next tick always has enough. Measured on testnet:
    ///         `scheduleCall` costs ~1.41M gas whatever gas limit it books; the rest covers the capacity probes
    ///         and bookkeeping. `gasLimit` must exceed this.
    uint256 public constant SCHEDULE_GAS_RESERVE = 1_600_000;
    /// @notice How early `tick()` is accepted. `block.timestamp` is the start of Hedera's ~2 s block, so a
    ///         schedule that fires exactly at `nextRunAt` can see a timestamp a second or two before it.
    uint256 public constant TIMESTAMP_TOLERANCE = 5;
    /// @notice Gas prices above this (tinybars per gas) are ignored as nonsense rather than recorded.
    uint256 public constant MAX_GAS_PRICE = 1_000_000;

    uint256 public immutable interval;
    uint256 public immutable gasLimit;

    uint256 public nextRunAt;
    uint256 public lastRunAt;
    address public nextSchedule;
    uint256 public runCount;
    /// @notice Tinybars per gas. Every network tick records the price it actually ran at (`tx.gasprice`).
    uint256 public gasPrice;

    bool private _ticking;

    event Ticked(uint256 indexed run, bool workOk, bytes reason);
    event TickScheduled(address indexed schedule, uint256 at);
    event ScheduleFailed(int64 responseCode, uint256 at);
    event Revived(address indexed by);
    event Funded(address indexed from, uint256 amount);
    event Stopped(uint256 runs);
    event GasPriceSet(uint256 tinybarsPerGas);

    /// @param interval_ seconds between ticks
    /// @param gasLimit_ gas each tick is booked with; must exceed `SCHEDULE_GAS_RESERVE`
    /// @param gasPrice_ starting estimate of the gas price in tinybars per gas (ticks then measure it)
    constructor(uint256 interval_, uint256 gasLimit_, uint256 gasPrice_) {
        if (interval_ == 0 || gasLimit_ <= SCHEDULE_GAS_RESERVE || gasPrice_ > MAX_GAS_PRICE) {
            revert ScheduledKeeper__InvalidConfig();
        }
        interval = interval_;
        gasLimit = gasLimit_;
        gasPrice = gasPrice_;
    }

    /// @notice Called by the Schedule Service at `nextRunAt`, and by nothing else.
    function tick() external {
        if (msg.sender != address(this)) revert ScheduledKeeper__OnlyNetwork();
        if (_ticking) revert ScheduledKeeper__Reentrant();
        if (nextRunAt == 0 || block.timestamp + TIMESTAMP_TOLERANCE < nextRunAt) {
            revert ScheduledKeeper__TooEarly(nextRunAt);
        }
        _ticking = true;

        // In a scheduled run tx.gasprice is the network's gas price in tinybars (82 on testnet, 2026-10-02).
        uint256 price = tx.gasprice;
        if (price != 0 && price != gasPrice && price <= MAX_GAS_PRICE) _setGasPrice(price);

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
        if (_ticking) revert ScheduledKeeper__Reentrant();
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

    /// @notice The most one scheduled run can cost, in tinybars: its whole gas limit at the current gas price.
    ///         Hedera won't start a run unless the reserve holds this much.
    function runCostEstimate() public view returns (uint256) {
        return gasLimit * gasPrice;
    }

    /// @notice Scheduled runs the current reserve can pay for, counting each at `runCostEstimate()`. A run usually
    ///         costs less (Hedera charges the gas a run uses; it only holds the full limit), so this never overstates.
    function runsLeft() public view returns (uint256) {
        uint256 cost = runCostEstimate();
        if (cost == 0) return type(uint256).max;
        return address(this).balance / cost;
    }

    /// @notice False when the reserve can't cover the next run's gas hold: Hedera would refuse to start it.
    function canPayNextRun() external view returns (bool) {
        return address(this).balance >= runCostEstimate();
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

    function _setGasPrice(uint256 tinybarsPerGas) internal {
        if (tinybarsPerGas > MAX_GAS_PRICE) revert ScheduledKeeper__InvalidConfig();
        gasPrice = tinybarsPerGas;
        emit GasPriceSet(tinybarsPerGas);
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
