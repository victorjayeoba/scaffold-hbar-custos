// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/// @notice The SaucerSwap V1 router calls Custos uses (a Uniswap V2 router with WHBAR in place of WETH).
/// @dev Paths use the WHBAR *token* (testnet 0.0.15058), not the WHBAR contract the router's `WHBAR()` returns.
interface ISaucerSwapRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);

    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory);

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
