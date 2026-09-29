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
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploys Custos on a local chain with mock oracles, a mock USDC and a mock SaucerSwap router.
 *         For Hedera testnet use `yarn custos:deploy:testnet` (scripts-js/custos.js): `forge script` cannot fork
 *         the Hedera JSON-RPC relay on current Foundry, nor simulate the Schedule and Token services.
 * @dev Env (all optional): KEEPER_INTERVAL (s, default 1800), KEEPER_GAS_LIMIT (default 4,000,000),
 *      KEEPER_RUN_COST (default 1.65e8), KEEPER_FUND (sent to the keeper's reserve, default 40 ether).
 */
contract DeployScript is ScaffoldETHDeploy {
    uint256 internal constant SUPRA_HBAR_USDT = 75;
    uint256 internal constant MAX_STALENESS = 7200;
    uint256 internal constant MAX_DEVIATION_BPS = 500;
    address internal constant WHBAR = 0x0000000000000000000000000000000000003aD2; // testnet WHBAR token 0.0.15058

    function run() external ScaffoldEthDeployerRunner {
        uint256 interval = vm.envOr("KEEPER_INTERVAL", uint256(1800));
        uint256 gasLimit = vm.envOr("KEEPER_GAS_LIMIT", uint256(4_000_000));
        uint256 runCost = vm.envOr("KEEPER_RUN_COST", uint256(165_000_000));
        uint256 fund = vm.envOr("KEEPER_FUND", uint256(40 ether));

        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        usdc.mint(deployer, 1_000_000e6);
        address chainlink = address(new MockAggregator(8, 12_000_000));
        address supra = address(new MockSupra(8, 12_000_000));
        MockSaucerRouter router = new MockSaucerRouter(usdc, WHBAR, 2_270_000);

        PriceGuard guard = new PriceGuard(chainlink, supra, SUPRA_HBAR_USDT, MAX_STALENESS, MAX_DEVIATION_BPS, deployer);
        LiquidityPool pool = new LiquidityPool(IERC20(address(usdc)), deployer);
        PerpMarket market = new PerpMarket(
            address(usdc), address(guard), address(pool), deployer, interval, gasLimit, runCost, address(router), WHBAR
        );
        pool.setMarket(address(market));
        if (fund > 0) market.fund{ value: fund }();

        deployments.push(Deployment({ name: "MockUSDC", addr: address(usdc) }));
        deployments.push(Deployment({ name: "MockAggregator", addr: chainlink }));
        deployments.push(Deployment({ name: "MockSupra", addr: supra }));
        deployments.push(Deployment({ name: "MockSaucerRouter", addr: address(router) }));
        deployments.push(Deployment({ name: "PriceGuard", addr: address(guard) }));
        deployments.push(Deployment({ name: "LiquidityPool", addr: address(pool) }));
        deployments.push(Deployment({ name: "PerpMarket", addr: address(market) }));
    }
}
