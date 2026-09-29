// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";
import { LiquidityPool } from "../contracts/LiquidityPool.sol";
import { PerpMarket } from "../contracts/PerpMarket.sol";
import { MockAggregator } from "../test/mocks/MockAggregator.sol";
import { MockSupra } from "../test/mocks/MockSupra.sol";
import { MockERC20 } from "../test/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploys Custos: PriceGuard → LiquidityPool → PerpMarket, links pool and market, funds the keeper.
 *         On Hedera testnet it uses Chainlink HBAR/USD, Supra HBAR/USDT and Circle's testnet USDC; on any
 *         other chain it deploys mocks. Starting the keeper and associating USDC need the Hedera system
 *         contracts, which a Foundry script cannot simulate: run `yarn custos:start:testnet` afterwards.
 * @dev Env (all optional): KEEPER_INTERVAL (s, default 600), KEEPER_GAS_LIMIT (default 1,000,000),
 *      KEEPER_RUN_COST (tinybars per run, default 1 HBAR), KEEPER_FUND (wei-bar sent to the reserve, default 20 HBAR).
 */
contract DeployScript is ScaffoldETHDeploy {
    address internal constant TESTNET_CHAINLINK_HBAR_USD = 0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a;
    address internal constant TESTNET_SUPRA = 0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917;
    uint256 internal constant SUPRA_HBAR_USDT = 75;
    /// @dev Supra testnet pushes roughly hourly, Chainlink every 3–56 min: two hours avoids false close-only.
    uint256 internal constant MAX_STALENESS = 7200;
    address internal constant TESTNET_USDC = 0x0000000000000000000000000000000000068cDa; // 0.0.429274

    function run() external ScaffoldEthDeployerRunner {
        uint256 interval = vm.envOr("KEEPER_INTERVAL", uint256(600));
        uint256 gasLimit = vm.envOr("KEEPER_GAS_LIMIT", uint256(1_000_000));
        uint256 runCost = vm.envOr("KEEPER_RUN_COST", uint256(1e8));
        uint256 fund = vm.envOr("KEEPER_FUND", uint256(20 ether));

        (address chainlink, address supra, address usdc) =
            block.chainid == 296 ? (TESTNET_CHAINLINK_HBAR_USD, TESTNET_SUPRA, TESTNET_USDC) : _deployMocks();

        PriceGuard guard = new PriceGuard(chainlink, supra, SUPRA_HBAR_USDT, MAX_STALENESS, 300, deployer);
        LiquidityPool pool = new LiquidityPool(IERC20(usdc), deployer);
        PerpMarket market = new PerpMarket(usdc, address(guard), address(pool), deployer, interval, gasLimit, runCost);
        pool.setMarket(address(market));
        if (fund > 0) market.fund{ value: fund }();

        deployments.push(Deployment({ name: "PriceGuard", addr: address(guard) }));
        deployments.push(Deployment({ name: "LiquidityPool", addr: address(pool) }));
        deployments.push(Deployment({ name: "PerpMarket", addr: address(market) }));
    }

    function _deployMocks() internal returns (address chainlink, address supra, address usdc) {
        chainlink = address(new MockAggregator(8, 12_000_000));
        supra = address(new MockSupra(8, 12_000_000));
        MockERC20 token = new MockERC20("USD Coin", "USDC", 6);
        token.mint(deployer, 1_000_000e6);
        usdc = address(token);
        deployments.push(Deployment({ name: "MockAggregator", addr: chainlink }));
        deployments.push(Deployment({ name: "MockSupra", addr: supra }));
        deployments.push(Deployment({ name: "MockUSDC", addr: usdc }));
    }
}
