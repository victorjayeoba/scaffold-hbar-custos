// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { MockERC20 } from "./MockERC20.sol";

/// @dev A SaucerSwap V1 router at a fixed rate: `rate` USDC units per 1e8 units of HBAR (1 HBAR in tinybars).
contract MockSaucerRouter {
    MockERC20 public immutable usdc;
    address public immutable whbar;
    uint256 public rate;

    constructor(MockERC20 usdc_, address whbar_, uint256 rate_) {
        usdc = usdc_;
        whbar = whbar_;
        rate = rate_;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory a) {
        a = new uint256[](2);
        a[0] = amountIn;
        a[1] = path[0] == whbar ? amountIn * rate / 1e8 : amountIn * 1e8 / rate;
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory a) {
        a = new uint256[](2);
        a[0] = path[0] == whbar ? (amountOut * 1e8 + rate - 1) / rate : (amountOut * rate + 1e8 - 1) / 1e8;
        a[1] = amountOut;
    }

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256)
        external
        payable
        returns (uint256[] memory a)
    {
        require(path[0] == whbar && path[1] == address(usdc), "path");
        a = getAmountsOut(msg.value, path);
        require(a[1] >= amountOutMin, "slippage");
        usdc.mint(to, a[1]);
    }

    function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory a)
    {
        require(path[0] == address(usdc) && path[1] == whbar, "path");
        a = getAmountsOut(amountIn, path);
        require(a[1] >= amountOutMin, "slippage");
        usdc.transferFrom(msg.sender, address(this), amountIn);
        (bool ok,) = to.call{ value: a[1] }("");
        require(ok, "send");
    }

    receive() external payable { }
}
