// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockAggregator {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;
    bool public broken;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        set(answer_, block.timestamp);
    }

    function set(int256 answer_, uint256 updatedAt_) public {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function setBroken(bool value) external {
        broken = value;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!broken, "feed down");
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
