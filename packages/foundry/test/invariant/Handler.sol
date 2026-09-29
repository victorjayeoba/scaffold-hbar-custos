// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { PerpMarket } from "../../contracts/PerpMarket.sol";
import { LiquidityPool } from "../../contracts/LiquidityPool.sol";
import { PriceGuard } from "../../contracts/PriceGuard.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockAggregator } from "../mocks/MockAggregator.sol";
import { MockSupra } from "../mocks/MockSupra.sol";

/// @dev Random but valid sequences of LP, trader, price and keeper actions.
contract Handler is Test {
    PerpMarket internal market;
    LiquidityPool internal pool;
    PriceGuard internal guard;
    MockERC20 internal usdc;
    MockAggregator internal chainlink;
    MockSupra internal supra;

    address[] public actors;
    uint256 public price8 = 12_000_000;

    /// @notice True right after a tick that ran at an `Ok` price.
    bool public justSweptAtOkPrice;
    uint256 public ticks;
    uint256 public networkLiquidations;

    constructor(
        PerpMarket market_,
        LiquidityPool pool_,
        PriceGuard guard_,
        MockERC20 usdc_,
        MockAggregator chainlink_,
        MockSupra supra_
    ) {
        market = market_;
        pool = pool_;
        guard = guard_;
        usdc = usdc_;
        chainlink = chainlink_;
        supra = supra_;
        for (uint256 i = 0; i < 8; i++) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            vm.startPrank(a);
            usdc.approve(address(market), type(uint256).max);
            usdc.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 seed, uint256 amount) external {
        justSweptAtOkPrice = false;
        address a = _actor(seed);
        amount = bound(amount, 1e6, 5_000e6);
        usdc.mint(a, amount);
        vm.prank(a);
        pool.deposit(amount, a);
    }

    function withdraw(uint256 seed, uint256 amount) external {
        justSweptAtOkPrice = false;
        address a = _actor(seed);
        uint256 max = pool.maxWithdraw(a);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(a);
        pool.withdraw(amount, a, a);
    }

    function open(uint256 seed, bool isLong, uint256 collateral, uint256 leverage) external {
        justSweptAtOkPrice = false;
        address a = _actor(seed);
        if (market.positionOf(a).size != 0) return;
        if (guard.status() != PriceGuard.Status.Ok) return;
        collateral = bound(collateral, 1e6, 200e6);
        leverage = bound(leverage, 1, 50);
        uint256 cap = usdc.balanceOf(address(pool)) * 5_000 / 10_000;
        if (market.totalOpenNotional() + collateral * leverage > cap) return;
        usdc.mint(a, collateral);
        vm.prank(a);
        market.open(isLong, collateral, leverage);
    }

    function close(uint256 seed) external {
        justSweptAtOkPrice = false;
        address a = _actor(seed);
        if (market.positionOf(a).size == 0) return;
        vm.warp(block.timestamp + 300);
        _refreshFeeds();
        vm.prank(a);
        market.close();
    }

    function addCollateral(uint256 seed, uint256 amount) external {
        justSweptAtOkPrice = false;
        address a = _actor(seed);
        if (market.positionOf(a).size == 0) return;
        amount = bound(amount, 1, 100e6);
        usdc.mint(a, amount);
        vm.prank(a);
        market.addCollateral(amount);
    }

    function movePrice(int256 moveBps) external {
        justSweptAtOkPrice = false;
        moveBps = bound(moveBps, -2_000, 2_000);
        int256 next = int256(price8) * (10_000 + moveBps) / 10_000;
        price8 = uint256(bound(next, 1_000_000, 100_000_000));
        vm.warp(block.timestamp + 60);
        _refreshFeeds();
    }

    function liquidate(uint256 seed) external {
        justSweptAtOkPrice = false;
        address a = _actor(seed);
        if (guard.status() != PriceGuard.Status.Ok) return;
        if (!market.isLiquidatable(a, guard.price())) return;
        market.liquidate(a);
    }

    function tick() external {
        if (market.nextRunAt() == 0) market.revive();
        if (market.nextRunAt() > block.timestamp) vm.warp(market.nextRunAt()); // time only moves forward
        _refreshFeeds();
        uint256 before = market.traderCount();
        market.tick();
        ticks++;
        networkLiquidations += before - market.traderCount();
        justSweptAtOkPrice = guard.status() == PriceGuard.Status.Ok;
    }

    function _refreshFeeds() internal {
        chainlink.set(int256(price8), block.timestamp);
        supra.set(price8, block.timestamp);
    }
}
