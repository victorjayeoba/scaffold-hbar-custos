import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

/** Same limits as PriceGuard.sol, so the page and the contract agree on when trading stops. */
export const MAX_STALENESS_SECONDS = 7200;
export const MAX_DEVIATION_BPS = 300;
const SUPRA_HBAR_USDT_PAIR = 75n;

export type FeedStatus = "loading" | "ok" | "stale" | "deviated";

export type Feed = { price: number; updatedAt: number } | undefined;

/**
 * Reads Chainlink HBAR/USD and Supra HBAR/USDT on Hedera testnet and applies PriceGuard's rules.
 * Chainlink is the price; Supra is the independent check.
 */
export const usePriceFeeds = () => {
  const { data: round } = useScaffoldReadContract({
    contractName: "ChainlinkHbarUsd",
    functionName: "latestRoundData",
  });
  const { data: supraRaw } = useScaffoldReadContract({
    contractName: "SupraPushOracle",
    functionName: "getSvalue",
    args: [SUPRA_HBAR_USDT_PAIR],
  });

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
  if (chainlink && supra) {
    const now = Math.floor(Date.now() / 1000);
    deviationBps = (Math.abs(chainlink.price - supra.price) / chainlink.price) * 10_000;
    if (now - chainlink.updatedAt > MAX_STALENESS_SECONDS || now - supra.updatedAt > MAX_STALENESS_SECONDS)
      status = "stale";
    else if (deviationBps > MAX_DEVIATION_BPS) status = "deviated";
    else status = "ok";
  }

  return { chainlink, supra, deviationBps, status };
};
