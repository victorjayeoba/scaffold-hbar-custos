import { POLL } from "~~/hooks/custos/poll";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

export type FeedStatus = "loading" | "ok" | "stale" | "deviated";

export type Feed = { price: number; updatedAt: number } | undefined;

/** A staleness limit for people: "12 h", or "90 min" when it isn't whole hours. */
export const fmtMaxAge = (seconds: number) =>
  seconds % 3600 === 0 ? `${seconds / 3600} h` : `${Math.round(seconds / 60)} min`;

/**
 * Reads Chainlink HBAR/USD and Supra HBAR/USDT on Hedera testnet and applies PriceGuard's rules.
 * Chainlink is the price; Supra is the independent check. The Supra pair and both limits (maxStaleness,
 * maxDeviationBps) are read from the live PriceGuard, so the page and the contract agree on when trading stops,
 * even after the owner moves them with setParams.
 */
export const usePriceFeeds = () => {
  // Immutable on the guard: read once.
  const { data: supraPair } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "supraPair",
    watch: false,
  });
  const { data: staleness } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "maxStaleness",
    ...POLL,
  });
  const { data: deviation } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "maxDeviationBps",
    ...POLL,
  });
  const { data: round } = useScaffoldReadContract({
    contractName: "ChainlinkHbarUsd",
    functionName: "latestRoundData",
    ...POLL,
  });
  const { data: supraRaw } = useScaffoldReadContract({
    contractName: "SupraPushOracle",
    functionName: "getSvalue",
    args: [supraPair],
    ...POLL,
  });

  const maxStaleness = staleness !== undefined ? Number(staleness) : undefined; // seconds
  const maxDeviationBps = deviation !== undefined ? Number(deviation) : undefined;

  // Chainlink answers with 8 decimals and a timestamp in seconds.
  const chainlink: Feed = round ? { price: Number(round[1]) / 1e8, updatedAt: Number(round[3]) } : undefined;
  // Supra reports its own decimals and a timestamp in milliseconds.
  const supra: Feed = supraRaw
    ? {
        price: Number(supraRaw.price) / 10 ** Number(supraRaw.decimals),
        updatedAt: Math.floor(Number(supraRaw.time) / 1000),
      }
    : undefined;

  let status: FeedStatus = "loading";
  let deviationBps: number | undefined;
  if (chainlink && supra) deviationBps = (Math.abs(chainlink.price - supra.price) / chainlink.price) * 10_000;
  if (deviationBps !== undefined && maxStaleness !== undefined && maxDeviationBps !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    if (now - chainlink!.updatedAt > maxStaleness || now - supra!.updatedAt > maxStaleness) status = "stale";
    else if (deviationBps > maxDeviationBps) status = "deviated";
    else status = "ok";
  }

  return { chainlink, supra, deviationBps, status, maxStaleness, maxDeviationBps, supraPair };
};
