// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";
import { LiquidityPool } from "../contracts/LiquidityPool.sol";
import { PerpMarket } from "../contracts/PerpMarket.sol";
import { MockAggregator } from "../test/mocks/MockAggregator.sol";
import { MockSupra } from "../test/mocks/MockSupra.sol";
import { MockERC20 } from "../test/mocks/MockERC20.sol";
import { MockSaucerRouter } from "../test/mocks/MockSaucerRouter.sol";
import { MockHederaScheduleService } from "../test/mocks/MockHederaScheduleService.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploys Custos on a local chain with mock oracles, a mock USDC and a mock SaucerSwap router.
 *         A local chain has no Hedera system contracts, so on anvil this first installs stand-ins with
 *         `anvil_setCode`: a small Token Service at 0x167 (so the pool can create its share token) and a Schedule
 *         Service at 0x16b that books ticks but never runs them. Trading and the pool work locally; the keeper
 *         only runs on Hedera.
 *         For Hedera testnet use `yarn custos:deploy:testnet` (scripts-js/custos.js): `forge script` cannot fork
 *         the Hedera JSON-RPC relay on current Foundry, nor simulate the Schedule and Token services.
 * @dev Env (all optional): KEEPER_INTERVAL (s, default 1800), KEEPER_GAS_LIMIT (default 4,000,000),
 *      KEEPER_RUN_COST (default 1.65e8), KEEPER_FUND (sent to the keeper's reserve, default 40 ether),
 *      MIN_COLLATERAL (USDC 6 dp, default 1e6), MAX_SWAP_DEVIATION_BPS (default 300: refuels must fill within 3% of
 *      the oracle price).
 */
contract DeployScript is ScaffoldETHDeploy {
    uint256 internal constant SUPRA_HBAR_USDT = 75;
    uint256 internal constant MAX_STALENESS = 7200;
    uint256 internal constant MAX_DEVIATION_BPS = 500;
    address internal constant WHBAR = 0x0000000000000000000000000000000000003aD2; // testnet WHBAR token 0.0.15058
    address internal constant HTS = 0x0000000000000000000000000000000000000167;
    address internal constant HSS = 0x000000000000000000000000000000000000016B;

    struct Config {
        uint256 interval;
        uint256 gasLimit;
        uint256 runCost;
        uint256 fund;
        uint256 minCollateral;
        uint256 maxSwapDeviation;
    }

    function run() external ScaffoldEthDeployerRunner {
        Config memory c = Config({
            interval: vm.envOr("KEEPER_INTERVAL", uint256(1800)),
            gasLimit: vm.envOr("KEEPER_GAS_LIMIT", uint256(4_000_000)),
            runCost: vm.envOr("KEEPER_RUN_COST", uint256(165_000_000)),
            fund: vm.envOr("KEEPER_FUND", uint256(40 ether)),
            minCollateral: vm.envOr("MIN_COLLATERAL", uint256(1e6)),
            maxSwapDeviation: vm.envOr("MAX_SWAP_DEVIATION_BPS", uint256(300))
        });
        if (block.chainid == 31337) _installLocalSystemContracts();

        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        usdc.mint(deployer, 1_000_000e6);
        address chainlink = address(new MockAggregator(8, 12_000_000));
        address supra = address(new MockSupra(8, 12_000_000));
        MockSaucerRouter router = new MockSaucerRouter(usdc, WHBAR, 120_000); // 1 HBAR = 0.12 USDC, like the oracle
        PriceGuard guard = new PriceGuard(chainlink, supra, SUPRA_HBAR_USDT, MAX_STALENESS, MAX_DEVIATION_BPS, deployer);

        deployments.push(Deployment({ name: "MockUSDC", addr: address(usdc) }));
        deployments.push(Deployment({ name: "MockAggregator", addr: chainlink }));
        deployments.push(Deployment({ name: "MockSupra", addr: supra }));
        deployments.push(Deployment({ name: "MockSaucerRouter", addr: address(router) }));
        deployments.push(Deployment({ name: "PriceGuard", addr: address(guard) }));
        _deployMarket(c, address(usdc), address(guard), address(router));
    }

    function _deployMarket(Config memory c, address usdc, address guard, address router) internal {
        LiquidityPool pool = new LiquidityPool(IERC20(usdc), deployer);
        PerpMarket market = new PerpMarket(
            usdc, guard, address(pool), deployer, c.interval, c.gasLimit, c.runCost, router, WHBAR, c.minCollateral,
            c.maxSwapDeviation
        );
        pool.setMarket(address(market));
        pool.createShareToken{ value: 1 ether }();
        if (c.fund > 0) market.fund{ value: c.fund }();
        deployments.push(Deployment({ name: "LiquidityPool", addr: address(pool) }));
        deployments.push(Deployment({ name: "PerpMarket", addr: address(market) }));
    }

    /// @dev Puts the HTS and HSS stand-ins on the anvil node (for the broadcast) and in this script's own view
    ///      (for the simulation that precedes it).
    function _installLocalSystemContracts() internal {
        _setCode(HTS, vm.getDeployedCode("MockHtsLocal.sol:MockHtsLocal"));
        _setCode(HSS, vm.getDeployedCode("MockHederaScheduleService.sol:MockHederaScheduleService"));
    }

    function _setCode(address where, bytes memory code) internal {
        vm.etch(where, code);
        string memory params =
            string.concat('["', vm.toString(where), '","', vm.toString(code), '"]');
        vm.rpc("anvil_setCode", params);
    }
}
