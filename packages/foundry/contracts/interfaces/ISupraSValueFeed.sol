// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/// @notice Supra's push oracle (S-Value feed). `time` is in milliseconds.
interface ISupraSValueFeed {
    struct PriceFeed {
        uint256 round;
        uint256 decimals;
        uint256 time;
        uint256 price;
    }

    function getSvalue(uint256 pairIndex) external view returns (PriceFeed memory);
}
