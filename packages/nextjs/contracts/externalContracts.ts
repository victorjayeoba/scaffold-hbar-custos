/**
 * This file contains external contract definitions (contracts not deployed by this project).
 * Add entries here to interact with pre-deployed contracts on any supported chain.
 *
 * Custos reads two keyless push oracles on Hedera testnet. PriceGuard (our contract) combines them;
 * the app reads them directly too, so the price shows before anything is deployed.
 */
import { GenericContractsDeclaration } from "~~/utils/scaffold-hbar/contract";

const chainlinkAggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80", internalType: "uint80" },
      { name: "answer", type: "int256", internalType: "int256" },
      { name: "startedAt", type: "uint256", internalType: "uint256" },
      { name: "updatedAt", type: "uint256", internalType: "uint256" },
      { name: "answeredInRound", type: "uint80", internalType: "uint80" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8", internalType: "uint8" }],
    stateMutability: "view",
  },
] as const;

const supraPushOracleAbi = [
  {
    type: "function",
    name: "getSvalue",
    inputs: [{ name: "pairIndex", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct ISupraSValueFeed.priceFeed",
        components: [
          { name: "round", type: "uint256", internalType: "uint256" },
          { name: "decimals", type: "uint256", internalType: "uint256" },
          { name: "time", type: "uint256", internalType: "uint256" },
          { name: "price", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

const externalContracts = {
  296: {
    // https://docs.chain.link/data-feeds/price-feeds/addresses?network=hedera
    ChainlinkHbarUsd: {
      address: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
      abi: chainlinkAggregatorAbi,
    },
    // https://docs.supra.com/oracles/data-feeds/push-oracle/networks (HBAR/USDT is pair 75)
    SupraPushOracle: {
      address: "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917",
      abi: supraPushOracleAbi,
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
