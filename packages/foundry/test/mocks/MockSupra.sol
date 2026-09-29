// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ISupraSValueFeed } from "../../contracts/interfaces/ISupraSValueFeed.sol";

contract MockSupra {
    uint256 public decimals;
    uint256 public price;
    uint256 public timeMs;

    constructor(uint256 decimals_, uint256 price_) {
        decimals = decimals_;
        set(price_, block.timestamp);
    }

    function set(uint256 price_, uint256 atSeconds) public {
        price = price_;
        timeMs = atSeconds * 1000;
    }

    function getSvalue(uint256) external view returns (ISupraSValueFeed.PriceFeed memory) {
        return ISupraSValueFeed.PriceFeed({ round: 1, decimals: decimals, time: timeMs, price: price });
    }
}
