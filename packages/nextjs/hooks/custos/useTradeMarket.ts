import { useMemo } from "react";
import { erc20Abi, zeroAddress } from "viem";
import { useReadContract } from "wagmi";
import { POLL } from "~~/hooks/custos/poll";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { CONTRACT_DEFAULTS, MarketParams, fundingRatePerHour } from "~~/utils/custos/perpMath";

/** Constants never change for a deployed contract: read once. */
const ONCE = { watch: false, query: { staleTime: Infinity, refetchInterval: false } } as const;

export type GuardStatus = "ok" | "stale" | "deviated";
const STATUS: GuardStatus[] = ["ok", "stale", "deviated"];

/**
 * Everything /trade needs about the market, read from the contracts it trades against:
 * - PriceGuard.read(): the exact price and status `open`, `close` and liquidations use
 * - PerpMarket's risk constants, open interest and funding state
 * - the pool's USDC balance, which the open-interest cap and funding are measured against
 */
export const useTradeMarket = () => {
  const { targetNetwork } = useTargetNetwork();

  const guardRead = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "read", ...POLL });
  const { data: maxStaleness } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "maxStaleness",
    ...POLL,
  });
  const { data: maxDeviationBps } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "maxDeviationBps",
    ...POLL,
  });

  const { data: maxLeverage } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "MAX_LEVERAGE",
    ...ONCE,
  });
  const { data: openFeeBps } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "OPEN_FEE_BPS",
    ...ONCE,
  });
  const { data: closeFeeBps } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "CLOSE_FEE_BPS",
    ...ONCE,
  });
  const { data: maintenanceBps } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "MAINTENANCE_BPS",
    ...ONCE,
  });
  const { data: maxOpenInterestBps } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "MAX_OPEN_INTEREST_BPS",
    ...ONCE,
  });
  const { data: minHoldSeconds } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "MIN_HOLD_SECONDS",
    ...ONCE,
  });
  const { data: fundingFactorPerHour } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "FUNDING_FACTOR_PER_HOUR",
    ...ONCE,
  });
  const { data: usdc } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "usdc", ...ONCE });
  const { data: pool } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "pool", ...ONCE });
  const { data: router } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "router", ...ONCE });

  const { data: longNotional } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "longNotional",
    ...POLL,
  });
  const { data: shortNotional } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "shortNotional",
    ...POLL,
  });
  const { data: traderCount } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "traderCount",
    ...POLL,
  });

  // The cap and funding use `usdc.balanceOf(pool)`, not the pool's own accounting.
  const { data: poolBalance } = useReadContract({
    chainId: targetNetwork.id,
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [pool ?? zeroAddress],
    query: { enabled: !!usdc && !!pool, ...POLL.query },
  });

  const { data: minCollateral } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "minCollateral",
    ...ONCE,
  });

  const params: MarketParams | undefined = useMemo(
    () =>
      maxLeverage !== undefined &&
      openFeeBps !== undefined &&
      closeFeeBps !== undefined &&
      maintenanceBps !== undefined &&
      maxOpenInterestBps !== undefined &&
      minHoldSeconds !== undefined &&
      fundingFactorPerHour !== undefined
        ? {
            maxLeverage,
            openFeeBps,
            closeFeeBps,
            maintenanceBps,
            maxOpenInterestBps,
            minHoldSeconds,
            fundingFactorPerHour,
          }
        : undefined,
    [maxLeverage, openFeeBps, closeFeeBps, maintenanceBps, maxOpenInterestBps, minHoldSeconds, fundingFactorPerHour],
  );

  const g = guardRead.data;
  const guard = g
    ? {
        /** Chainlink's price, 1e18. 0 when Chainlink didn't answer. */
        price: g[0],
        status: STATUS[g[1]] ?? "stale",
        chainlinkAt: Number(g[2]),
        supraAt: Number(g[3]),
        deviationBps: Number(g[4]),
      }
    : undefined;

  const openInterest =
    longNotional !== undefined && shortNotional !== undefined ? longNotional + shortNotional : undefined;
  const fundingRate =
    longNotional !== undefined && shortNotional !== undefined && poolBalance !== undefined
      ? fundingRatePerHour(longNotional, shortNotional, poolBalance, params ?? CONTRACT_DEFAULTS)
      : undefined;

  return {
    guard,
    guardError: guardRead.error,
    guardLoading: guardRead.isLoading,
    maxStaleness: maxStaleness !== undefined ? Number(maxStaleness) : undefined,
    maxDeviationBps: maxDeviationBps !== undefined ? Number(maxDeviationBps) : undefined,
    params,
    usdc,
    pool,
    /** False when the market was deployed without SaucerSwap: `openWithHbar` reverts `PerpMarket__SwapDisabled`. */
    swapEnabled: router === undefined ? undefined : router !== zeroAddress,
    poolBalance,
    /** The market's minimum collateral (USDC). */
    minCollateral,
    /** The market can pay a close out in HBAR (`closeToHbar`): needs SaucerSwap. */
    canCloseToHbar: router !== undefined && router !== zeroAddress,
    longNotional,
    shortNotional,
    openInterest,
    traderCount,
    /** Funding per hour, 1e18 = 100%. Positive: longs pay. */
    fundingRate,
  };
};

export type TradeMarket = ReturnType<typeof useTradeMarket>;
