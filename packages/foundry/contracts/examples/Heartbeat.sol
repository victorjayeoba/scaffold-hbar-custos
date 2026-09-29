// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { ScheduledKeeper } from "../ScheduledKeeper.sol";

/**
 * @title Heartbeat
 * @notice The smallest ScheduledKeeper: counts its own beats and stops after `maxBeats`.
 *         Used to prove self-rescheduling on testnet, and as the reuse example in AGENTS.md.
 */
contract Heartbeat is ScheduledKeeper {
    uint256 public immutable maxBeats;
    uint256 public beats;

    event Beat(uint256 indexed beat, uint256 at);

    constructor(uint256 interval_, uint256 gasLimit_, uint256 runCostEstimate_, uint256 maxBeats_)
        ScheduledKeeper(interval_, gasLimit_, runCostEstimate_)
    {
        maxBeats = maxBeats_;
    }

    function _work() internal override {
        emit Beat(++beats, block.timestamp);
    }

    function _keepGoing() internal view override returns (bool) {
        return maxBeats == 0 || runCount < maxBeats;
    }
}
