// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";
import { MockAggregator } from "./mocks/MockAggregator.sol";
import { MockSupra } from "./mocks/MockSupra.sol";

contract PriceGuardTest is Test {
    MockAggregator internal chainlink;
    MockSupra internal supra;
    PriceGuard internal guard;

    function setUp() public {
        vm.warp(1_000_000);
        chainlink = new MockAggregator(8, 12_000_000); // $0.12
        supra = new MockSupra(18, 0.1211e18); // 0.9% above
        guard = new PriceGuard(address(chainlink), address(supra), 75, 3600, 300, address(this));
    }

    function test_priceScaledTo18Decimals() public view {
        assertEq(guard.price(), 0.12e18);
        (uint256 p, PriceGuard.Status s, uint256 clAt, uint256 spAt, uint256 dev) = guard.read();
        assertEq(p, 0.12e18);
        assertEq(uint256(s), uint256(PriceGuard.Status.Ok));
        assertEq(clAt, block.timestamp);
        assertEq(spAt, block.timestamp);
        assertEq(dev, 91); // 0.0011 / 0.12 = 0.9166%
    }

    function test_supraDecimalsScaled() public {
        supra.set(0, block.timestamp);
        MockSupra s8 = new MockSupra(8, 12_100_000);
        PriceGuard g = new PriceGuard(address(chainlink), address(s8), 75, 3600, 300, address(this));
        (,,,, uint256 dev) = g.read();
        assertEq(dev, 83); // 0.121 vs 0.12
    }

    function test_staleChainlink() public {
        vm.warp(block.timestamp + 3601);
        supra.set(0.1211e18, block.timestamp);
        assertEq(uint256(guard.status()), uint256(PriceGuard.Status.Stale));
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PriceGuard__NotOk.selector, PriceGuard.Status.Stale));
        guard.price();
    }

    function test_staleSupra() public {
        vm.warp(block.timestamp + 3601);
        chainlink.set(12_000_000, block.timestamp);
        assertEq(uint256(guard.status()), uint256(PriceGuard.Status.Stale));
    }

    function test_exactlyMaxStalenessIsOk() public {
        vm.warp(block.timestamp + 3600);
        assertEq(uint256(guard.status()), uint256(PriceGuard.Status.Ok));
    }

    function test_deviated() public {
        supra.set(0.1237e18, block.timestamp); // 3.08%
        (uint256 p, PriceGuard.Status s,,, uint256 dev) = guard.read();
        assertEq(uint256(s), uint256(PriceGuard.Status.Deviated));
        assertEq(dev, 308);
        assertEq(p, 0.12e18); // read still reports the price
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PriceGuard__NotOk.selector, PriceGuard.Status.Deviated));
        guard.price();
    }

    function test_brokenFeedReadsStaleWithoutReverting() public {
        chainlink.setBroken(true);
        (uint256 p, PriceGuard.Status s,,,) = guard.read();
        assertEq(p, 0);
        assertEq(uint256(s), uint256(PriceGuard.Status.Stale));
    }

    function test_nonPositiveAnswerIsStale() public {
        chainlink.set(0, block.timestamp);
        assertEq(uint256(guard.status()), uint256(PriceGuard.Status.Stale));
        chainlink.set(-1, block.timestamp);
        assertEq(uint256(guard.status()), uint256(PriceGuard.Status.Stale));
    }

    function test_setParamsOnlyOwner() public {
        guard.setParams(60, 100);
        assertEq(guard.maxStaleness(), 60);
        assertEq(guard.maxDeviationBps(), 100);

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        guard.setParams(60, 100);

        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        guard.setParams(0, 100);
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        guard.setParams(60, 10_000);
    }

    function test_constructorRejectsZeroFeeds() public {
        vm.expectRevert(PriceGuard.PriceGuard__InvalidConfig.selector);
        new PriceGuard(address(0), address(supra), 75, 3600, 300, address(this));
    }
}
