import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AbiError } from "abitype";
import {
  Abi,
  BaseError,
  ContractFunctionRevertedError,
  Hex,
  UserRejectedRequestError,
  decodeErrorResult,
  formatUnits,
} from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useTargetNetwork, useTransactor } from "~~/hooks/scaffold-hbar";
import { notification } from "~~/utils/scaffold-hbar";
import { contracts } from "~~/utils/scaffold-hbar/contract";

/*//////////////////////////////////////////////////////////////
                    CONTRACT ERRORS IN PLAIN WORDS
//////////////////////////////////////////////////////////////*/

const STATUS_WORDS = ["fine", "stale", "in disagreement"] as const;

const usdc = (v: unknown) => `${Number(formatUnits(BigInt(v as bigint), 6)).toLocaleString("en-US")} USDC`;
const clock = (unix: unknown) => {
  const at = Number(unix);
  const left = Math.max(0, at - Math.floor(Date.now() / 1000));
  const time = new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${time} (${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} from now)`;
};

/**
 * Every custom error /trade can hit, from PerpMarket, PriceGuard, the keeper and the token plumbing.
 * Keys are error names; values turn the error's arguments into a sentence a trader can act on.
 */
const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  // PerpMarket
  PerpMarket__ZeroAmount: () => "Enter an amount above zero.",
  PerpMarket__InvalidLeverage: () =>
    "Leverage must be a whole number from 1x to 50x, and the opening fee has to be smaller than your collateral.",
  PerpMarket__PositionExists: () =>
    "You already have an open position. Each account holds one: close it, or add collateral to it, before opening another.",
  PerpMarket__NoPosition: () =>
    "You have no open position. It may already be closed, or the network may have liquidated it.",
  PerpMarket__OpenInterestCap: ([cap]) =>
    `The market is full. Open positions may use at most half of the pool (${usdc(cap)} right now). Lower the size or leverage, or wait for the pool to grow.`,
  PerpMarket__HoldTime: ([closeableAt]) =>
    `Positions stay open for at least 5 minutes. You can close at ${clock(closeableAt)}.`,
  PerpMarket__NoPrice: () =>
    "Chainlink isn't returning a price, so the market can't value your position. Try again once the feed answers.",
  PerpMarket__NotLiquidatable: () => "That position is above its maintenance margin, so it can't be liquidated.",
  PerpMarket__SwapDisabled: () =>
    "HBAR swaps are turned off on this market (it has no SaucerSwap router). Use USDC instead.",
  PerpMarket__ReserveNotLow: ([runs]) =>
    `The keeper still has enough HBAR for ${String(runs)} runs, so it doesn't need refuelling yet.`,
  PerpMarket__NothingToSpend: () => "The pool has no spare USDC to refuel the keeper with.",
  PerpMarket__InvalidAddress: () => "The market was set up with a missing address. This is a deployment problem.",
  PerpMarket__BelowMinCollateral: ([min]) =>
    `Positions need at least ${usdc(min)} of collateral. Put in more (with HBAR, that's after the swap).`,
  PerpMarket__InvalidConfig: () => "The market was set up with invalid limits. This is a deployment problem.",
  PerpMarket__OnlyKeeper: () => "Only the market's own scheduled check can do this.",
  // PriceGuard
  PriceGuard__NotOk: ([status]) =>
    `Prices are ${STATUS_WORDS[Number(status)] ?? "not usable"}, so the market is close-only. New positions open again once Chainlink and Supra are both fresh and agree. You can still close a position or add collateral.`,
  PriceGuard__InvalidConfig: () => "PriceGuard was given invalid limits. This is a deployment problem.",
  // ScheduledKeeper
  ScheduledKeeper__TooEarly: ([at]) => `The next network check isn't due until ${clock(at)}.`,
  ScheduledKeeper__NotOverdue: ([at]) => `The schedule isn't broken; it can only be revived after ${clock(at)}.`,
  ScheduledKeeper__OnlySelf: () => "Only the market itself can run this step.",
  ScheduledKeeper__Reentrant: () => "A network check is already running. Try again in a moment.",
  ScheduledKeeper__InvalidConfig: () => "The keeper was given invalid settings. This is a deployment problem.",
  // OpenZeppelin and token plumbing
  ReentrancyGuardReentrantCall: () => "Another call to the market is still running. Try again in a moment.",
  SafeERC20FailedOperation: () =>
    "The USDC transfer failed. Check that you hold enough USDC, that you approved the market for this amount, and that your account is associated with USDC.",
  ERC20InsufficientBalance: () => "Not enough USDC in your account for this.",
  ERC20InsufficientAllowance: () => "The market isn't approved to take this much USDC. Approve it first.",
  OwnableUnauthorizedAccount: () => "Only the market's owner can do this.",
  LiquidityPool__ExceedsFreeAssets: ([free]) => `The pool only has ${usdc(free)} free right now.`,
  LiquidityPool__OnlyMarket: () => "Only the market can move pool funds.",
};

/** Plain-text revert reasons (SaucerSwap's router is a Uniswap V2 fork and reverts with strings). */
const REASONS: [RegExp, string][] = [
  [
    /INSUFFICIENT_OUTPUT_AMOUNT/i,
    "SaucerSwap would return less than your slippage limit allows. The rate moved: get a fresh quote or allow more slippage.",
  ],
  [/EXPIRED/i, "The swap deadline passed before the transaction ran. Try again."],
  [/INSUFFICIENT_LIQUIDITY/i, "SaucerSwap's HBAR/USDC pool doesn't have enough liquidity for this amount."],
  [/TRANSFER_FAILED/i, "A token transfer inside the swap failed. Check your USDC association and try again."],
];

/** Hedera network status codes that reach the wallet as plain text. */
const HEDERA_CODES: [RegExp, string][] = [
  [/TOKEN_NOT_ASSOCIATED_TO_ACCOUNT/i, "Your account isn't associated with USDC yet. Associate it first (step 1)."],
  [/SPENDER_DOES_NOT_HAVE_ALLOWANCE|AMOUNT_EXCEEDS_ALLOWANCE/i, "Approve the market for this much USDC first."],
  [/INSUFFICIENT_TOKEN_BALANCE/i, "Not enough USDC in your account for this."],
  [
    /INSUFFICIENT_PAYER_BALANCE|INSUFFICIENT_ACCOUNT_BALANCE|insufficient funds/i,
    "Not enough HBAR to pay for this transaction and its fee.",
  ],
  [
    /INSUFFICIENT_GAS|out of gas/i,
    "The transaction ran out of gas. Try again; the wallet may need a higher gas limit.",
  ],
  [
    /WRONG_NONCE|nonce too low/i,
    "Your wallet's transaction count is out of sync. Reset the account in your wallet and retry.",
  ],
];

/**
 * PerpMarket functions and errors from the next contract version (backend `contracts` branch, b059795), not yet in
 * deployedContracts.ts. Calls and reads that use them are gated on `marketHasFunction`, so on today's market they
 * never run; after the redeploy and ABI regen these duplicate the generated entries and nothing else changes.
 */
export const NEXT_MARKET_ABI = [
  {
    type: "function",
    name: "closeToHbar",
    stateMutability: "nonpayable",
    inputs: [{ name: "minHbarOut", type: "uint256" }],
    outputs: [{ name: "hbarOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteUsdcToHbar",
    stateMutability: "view",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "closePrice",
    stateMutability: "view",
    inputs: [{ name: "trader", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minCollateral",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "error", name: "PerpMarket__BelowMinCollateral", inputs: [{ name: "minCollateral", type: "uint256" }] },
  { type: "error", name: "PerpMarket__InvalidConfig", inputs: [] },
  { type: "error", name: "PerpMarket__OnlyKeeper", inputs: [] },
] as const;

let errorAbiCache: { chainId: number; abi: AbiError[] } | undefined;

/** Every custom error declared by any contract the app knows on this chain, deduplicated by signature. */
const allErrors = (chainId: number): AbiError[] => {
  if (errorAbiCache?.chainId === chainId) return errorAbiCache.abi;
  const seen = new Set<string>();
  const abi: AbiError[] = [];
  const onChain = (contracts as Record<number, Record<string, { abi: Abi }>> | undefined)?.[chainId] ?? {};
  for (const contractAbi of [...Object.values(onChain).map(c => c.abi), NEXT_MARKET_ABI as Abi]) {
    for (const item of contractAbi) {
      if (item.type !== "error") continue;
      const key = `${item.name}(${item.inputs.map(i => i.type).join(",")})`;
      if (seen.has(key)) continue;
      seen.add(key);
      abi.push(item);
    }
  }
  errorAbiCache = { chainId, abi };
  return abi;
};

const findRevertData = (error: unknown): Hex | undefined => {
  let e: any = error;
  for (let depth = 0; e && depth < 8; depth++, e = e.cause) {
    const raw = e.raw ?? e.data?.data ?? e.data;
    if (typeof raw === "string" && /^0x[0-9a-f]{8,}$/i.test(raw)) return raw as Hex;
  }
  return undefined;
};

/** Turns any wallet, RPC or contract error into one sentence. `hint` is added when the revert carries no data. */
export const humanizeTradeError = (error: unknown, chainId: number, hint?: string): string => {
  if (error instanceof BaseError) {
    if (error.walk(e => e instanceof UserRejectedRequestError)) return "You cancelled the request in your wallet.";

    const reverted = error.walk(e => e instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | undefined;
    if (reverted?.data && reverted.data.errorName !== "Error" && reverted.data.errorName !== "Panic") {
      const message = MESSAGES[reverted.data.errorName];
      if (message) return message(reverted.data.args ?? []);
    }
    if (reverted?.reason) {
      const known = REASONS.find(([re]) => re.test(reverted.reason!));
      if (known) return known[1];
    }
  }

  const raw = findRevertData(error);
  if (raw) {
    try {
      const decoded = decodeErrorResult({ abi: allErrors(chainId), data: raw });
      const message = MESSAGES[decoded.errorName];
      if (message) return message(decoded.args ?? []);
      return `The contract refused: ${decoded.errorName}.`;
    } catch {
      // Not one of ours; fall through to the text checks.
    }
  }

  const text = [
    (error as any)?.shortMessage,
    (error as any)?.details,
    (error as any)?.message,
    (error as any)?.cause?.message,
  ]
    .filter(Boolean)
    .join(" ");
  for (const [re, message] of [...REASONS, ...HEDERA_CODES]) if (re.test(text)) return message;
  if (/user rejected|user denied|rejected the request/i.test(text)) return "You cancelled the request in your wallet.";
  if (/execution reverted|CONTRACT_REVERT_EXECUTED|reverted/i.test(text))
    return hint ?? "The contract refused this transaction without giving a reason.";
  return (error as any)?.shortMessage ?? (error as any)?.message ?? "Something went wrong. Please try again.";
};

/*//////////////////////////////////////////////////////////////
                         MARKET TRANSACTIONS
//////////////////////////////////////////////////////////////*/

export type MarketCall =
  | { functionName: "open"; args: readonly [boolean, bigint, bigint] }
  | { functionName: "openWithHbar"; args: readonly [boolean, bigint, bigint]; value: bigint }
  | { functionName: "addCollateral"; args: readonly [bigint] }
  | { functionName: "close"; args?: undefined }
  | { functionName: "closeToHbar"; args: readonly [bigint] };

/**
 * Gas used if the RPC can't estimate. Hedera charges at least 80% of the limit, so estimates are preferred; these
 * are the limits the repo's own scripts send with (`custos.js`), with room for HTS transfers.
 */
const FALLBACK_GAS: Record<MarketCall["functionName"], bigint> = {
  open: 1_500_000n,
  openWithHbar: 3_000_000n,
  addCollateral: 1_000_000n,
  close: 1_500_000n,
  closeToHbar: 3_000_000n,
};

/** True when the deployed PerpMarket has this function (for features the backend is still adding). */
export const marketHasFunction = (chainId: number, name: string) => {
  const market = (contracts as Record<number, Record<string, { abi: Abi }>> | undefined)?.[chainId]?.PerpMarket;
  return !!market?.abi.some(item => item.type === "function" && item.name === name);
};

/**
 * Sends one PerpMarket transaction the careful way:
 * 1. simulate it with every known error ABI, so a revert comes back as a plain sentence before the wallet opens
 * 2. estimate gas (+30%), falling back to known-good limits
 * 3. send through the scaffold transactor (toasts with a HashScan link), then refresh every read on the page
 * It sends with the generated PerpMarket ABI plus NEXT_MARKET_ABI, so calls the deployed ABI doesn't type yet
 * (closeToHbar) go through the same path. Callers gate those on `marketHasFunction`.
 */
export const useTradeAction = () => {
  const { targetNetwork } = useTargetNetwork();
  const chainId = targetNetwork.id;
  const { address: account, chain: accountChain } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  const { data: market } = useDeployedContractInfo({ contractName: "PerpMarket" });
  const { writeContractAsync } = useWriteContract();
  const writeTx = useTransactor();

  const [pending, setPending] = useState<MarketCall["functionName"]>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => {
    queryClient.invalidateQueries();
    // The relay and mirror node can trail consensus by a few seconds; look again shortly after.
    setTimeout(() => queryClient.invalidateQueries(), 5_000);
  }, [queryClient]);

  const run = useCallback(
    async (call: MarketCall, hint?: string): Promise<boolean> => {
      setError(undefined);
      if (!account || !publicClient || !market) {
        setError("Connect your wallet first.");
        return false;
      }
      if (accountChain?.id !== chainId) {
        setError(`Your wallet is on another network. Switch it to ${targetNetwork.name}.`);
        return false;
      }
      setPending(call.functionName);
      try {
        // The PerpMarket ABI plus every other error we know (PriceGuard's bubble up through `open`).
        const abi = [...(market.abi as Abi), ...(NEXT_MARKET_ABI as Abi), ...allErrors(chainId)] as Abi;
        const request = {
          address: market.address,
          abi,
          functionName: call.functionName,
          args: call.args ?? [],
          value: "value" in call ? call.value : undefined,
          account,
        } as const;

        try {
          await publicClient.simulateContract(request);
        } catch (e) {
          const message = humanizeTradeError(e, chainId, hint);
          setError(message);
          notification.error(message);
          return false;
        }

        let gas = FALLBACK_GAS[call.functionName];
        try {
          gas = ((await publicClient.estimateContractGas(request)) * 13n) / 10n;
        } catch {
          // Keep the fallback.
        }

        const hash = await writeTx(() => writeContractAsync({ ...request, chainId, gas }));
        refresh();
        return !!hash;
      } catch (e) {
        // The transactor already showed a toast; keep a sentence on the page too.
        setError(humanizeTradeError(e, chainId, hint));
        refresh();
        return false;
      } finally {
        setPending(undefined);
      }
    },
    [
      account,
      accountChain?.id,
      publicClient,
      market,
      chainId,
      targetNetwork.name,
      writeTx,
      writeContractAsync,
      refresh,
    ],
  );

  return { run, pending, error, clearError: () => setError(undefined), refresh };
};
