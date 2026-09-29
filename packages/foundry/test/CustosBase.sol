// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";
import { LiquidityPool } from "../contracts/LiquidityPool.sol";
import { PerpMarket } from "../contracts/PerpMarket.sol";
import { MockAggregator } from "./mocks/MockAggregator.sol";
import { MockSupra } from "./mocks/MockSupra.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockHederaScheduleService } from "./mocks/MockHederaScheduleService.sol";

/// @dev Full Custos stack on mocks: $0.12 HBAR, 10,000 USDC in the pool.
abstract contract CustosBase is Test {
    address internal constant HSS_ADDRESS = 0x000000000000000000000000000000000000016B;
    uint256 internal constant POOL_SEED = 10_000e6;

    MockERC20 internal usdc;
    MockAggregator internal chainlink;
    MockSupra internal supra;
    PriceGuard internal guard;
    LiquidityPool internal pool;
    PerpMarket internal market;

    address internal lp = makeAddr("lp");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal liquidator = makeAddr("liquidator");

    function setUp() public virtual {
        vm.etch(HSS_ADDRESS, address(new MockHederaScheduleService()).code);
        MockHederaScheduleService(HSS_ADDRESS).setHasCapacity(true);
        MockHederaScheduleService(HSS_ADDRESS).setScheduleResponseCode(int64(22));
        vm.warp(1_000_000);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        chainlink = new MockAggregator(8, 12_000_000);
        supra = new MockSupra(8, 12_000_000);
        guard = new PriceGuard(address(chainlink), address(supra), 75, 3600, 300, address(this));
        pool = new LiquidityPool(usdc, address(this));
        market = new PerpMarket(address(usdc), address(guard), address(pool), address(this), 300, 2_500_000, 1e8);
        pool.setMarket(address(market));

        _fund(lp, POOL_SEED);
        vm.startPrank(lp);
        usdc.approve(address(pool), type(uint256).max);
        pool.deposit(POOL_SEED, lp);
        vm.stopPrank();

        _fund(alice, 1_000e6);
        _fund(bob, 1_000e6);
    }

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(market), type(uint256).max);
    }

    /// @dev Moves both feeds together, fresh at the current time.
    function _setPrice(uint256 price8) internal {
        chainlink.set(int256(price8), block.timestamp);
        supra.set(price8, block.timestamp);
    }

    function _open(address who, bool isLong, uint256 collateral, uint256 leverage) internal {
        vm.prank(who);
        market.open(isLong, collateral, leverage);
    }
}
