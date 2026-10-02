// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { htsSetup } from "hedera-forking/htsSetup.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";
import { LiquidityPool } from "../contracts/LiquidityPool.sol";
import { PerpMarket } from "../contracts/PerpMarket.sol";
import { MockAggregator } from "./mocks/MockAggregator.sol";
import { MockSupra } from "./mocks/MockSupra.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockHederaScheduleService } from "./mocks/MockHederaScheduleService.sol";

/// @dev Runs every market in `markets.json` through the same life: the guard accepts its config, a long and a short
///      open at the market's reference price, the network liquidates the long on a 15% drop, the short closes, and the
///      pool's books balance. Adding a market to `markets.json` is enough for it to be tested here.
contract MarketsTest is Test {
    address internal constant HSS_ADDRESS = 0x000000000000000000000000000000000000016B;

    struct Stack {
        MockERC20 usdc;
        MockAggregator chainlink;
        MockSupra supra;
        PriceGuard guard;
        LiquidityPool pool;
        PerpMarket market;
    }

    string internal json;
    address internal lp = makeAddr("lp");
    address internal longTrader = makeAddr("long");
    address internal shortTrader = makeAddr("short");

    function setUp() public {
        htsSetup();
        vm.etch(HSS_ADDRESS, address(new MockHederaScheduleService()).code);
        vm.warp(1_000_000);
        json = vm.readFile(string.concat(vm.projectRoot(), "/markets.json"));
    }

    function test_marketsFileHasTheDefaultMarket() public view {
        string[] memory names = vm.parseJsonKeys(json, "$");
        bool found;
        for (uint256 i = 0; i < names.length; i++) {
            if (keccak256(bytes(names[i])) == keccak256("HBAR-USD")) found = true;
        }
        assertTrue(found, "HBAR-USD missing from markets.json");
    }

    function test_everyMarketLivesAFullCycle() public {
        string[] memory names = vm.parseJsonKeys(json, "$");
        assertGt(names.length, 0);
        for (uint256 i = 0; i < names.length; i++) {
            _cycle(names[i]);
        }
    }

    function _cycle(string memory name) internal {
        string memory key = string.concat('$["', name, '"]');
        uint256 refPrice8 = vm.parseJsonUint(json, string.concat(key, ".refPrice8"));
        uint256 staleness = vm.parseJsonUint(json, string.concat(key, ".maxStaleness"));
        uint256 deviation = vm.parseJsonUint(json, string.concat(key, ".maxDeviationBps"));
        assertTrue(vm.parseJsonAddress(json, string.concat(key, ".chainlink")) != address(0), name);
        assertTrue(vm.parseJsonAddress(json, string.concat(key, ".supra")) != address(0), name);
        vm.parseJsonUint(json, string.concat(key, ".supraPair")); // must be present
        assertGt(refPrice8, 0, name);

        Stack memory s = _deploy(refPrice8, staleness, deviation);
        assertEq(uint256(s.guard.status()), uint256(PriceGuard.Status.Ok), name);
        assertEq(s.guard.price(), refPrice8 * 1e10, name);

        // a 10x long and a 5x short at the reference price
        _openAs(s, longTrader, true, 100e6, 10);
        _openAs(s, shortTrader, false, 100e6, 5);
        int256 longSize = s.market.positionOf(longTrader).size;
        assertEq(longSize, int256(uint256(1_000e6) * 1e30 / (refPrice8 * 1e10)), name); // size in the asset's units

        // 15% down: the 10x long is past its 1% maintenance margin, the network liquidates it on the next tick
        vm.warp(block.timestamp + 300);
        _setPrice(s, refPrice8 * 85 / 100);
        assertTrue(s.market.isLiquidatable(longTrader, refPrice8 * 85 / 100 * 1e10), name);
        uint256 poolBefore = s.usdc.balanceOf(address(s.pool));
        s.market.revive();
        vm.warp(s.market.nextRunAt());
        _setPrice(s, refPrice8 * 85 / 100);
        vm.prank(address(s.market));
        s.market.tick();
        assertEq(s.market.positionOf(longTrader).size, 0, name);
        assertEq(s.usdc.balanceOf(address(s.pool)) - poolBefore, 99e6, name); // all collateral, no reward

        // the short is up ~15% of 500: it closes at a profit the pool pays
        uint256 before = s.usdc.balanceOf(shortTrader);
        vm.prank(shortTrader);
        s.market.close();
        assertGt(s.usdc.balanceOf(shortTrader) - before, 100e6, name);

        // books are empty and balanced
        assertEq(s.market.traderCount(), 0, name);
        assertEq(s.market.totalCollateral(), 0, name);
        assertEq(s.usdc.balanceOf(address(s.market)), 0, name);
        assertEq(s.pool.totalAssets(), s.usdc.balanceOf(address(s.pool)), name);
    }

    function _deploy(uint256 refPrice8, uint256 staleness, uint256 deviation) internal returns (Stack memory s) {
        s.usdc = new MockERC20("USD Coin", "USDC", 6);
        s.chainlink = new MockAggregator(8, int256(refPrice8));
        s.supra = new MockSupra(8, refPrice8);
        s.guard = new PriceGuard(address(s.chainlink), address(s.supra), 1, staleness, deviation, address(this));
        s.pool = new LiquidityPool(s.usdc, address(this));
        s.market = new PerpMarket(
            address(s.usdc),
            address(s.guard),
            address(s.pool),
            address(this),
            300,
            2_500_000,
            40,
            address(0),
            address(0),
            1e6,
            300
        );
        vm.deal(address(s.market), 100e8);
        s.pool.setMarket(address(s.market));
        s.pool.createShareToken{ value: 1e8 }();

        s.usdc.mint(lp, 10_000e6);
        vm.startPrank(lp);
        s.usdc.approve(address(s.pool), type(uint256).max);
        s.pool.deposit(10_000e6, lp);
        vm.stopPrank();
    }

    function _openAs(Stack memory s, address who, bool isLong, uint256 collateral, uint256 leverage) internal {
        s.usdc.mint(who, collateral);
        vm.startPrank(who);
        s.usdc.approve(address(s.market), type(uint256).max);
        s.market.open(isLong, collateral, leverage);
        vm.stopPrank();
    }

    function _setPrice(Stack memory s, uint256 price8) internal {
        s.chainlink.set(int256(price8), block.timestamp);
        s.supra.set(price8, block.timestamp);
    }

    receive() external payable { }
}
