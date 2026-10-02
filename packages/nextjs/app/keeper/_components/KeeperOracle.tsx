"use client";

import { formatUnits } from "viem";
import { POLL } from "~~/hooks/custos/poll";
import { ago, useNow } from "~~/hooks/custos/useNow";
import { usePriceFeeds } from "~~/hooks/custos/usePriceFeeds";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

// PriceGuard.Status
const STATUS = [
  { label: "Open", tone: "badge-success", text: "Prices agree. Trading is open and the keeper liquidates." },
  {
    label: "Close-only",
    tone: "badge-warning",
    text: "A feed is too old. New positions are blocked and each check skips liquidations (SweepSkipped) until it updates.",
  },
  {
    label: "Close-only",
    tone: "badge-error",
    text: "The feeds disagree too much. New positions are blocked and each check skips liquidations (SweepSkipped).",
  },
] as const;

/** What PriceGuard says right now: the price every check uses, and whether the keeper may liquidate at it. */
export const KeeperOracle = () => {
  const now = useNow();
  const { supra } = usePriceFeeds();
  const { data: guard, isError } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "read",
    ...POLL,
  });
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

  const [price, status, chainlinkAt, supraAt, deviationBps] = guard ?? [];
  const verdict = status !== undefined ? STATUS[status] : undefined;
  const maxAge = maxStaleness !== undefined ? Number(maxStaleness) : undefined;

  const feeds = [
    {
      name: "Chainlink",
      pair: "HBAR / USD",
      role: "the price",
      price: price ? Number(formatUnits(price, 18)) : undefined,
      at: chainlinkAt ? Number(chainlinkAt) : undefined,
    },
    {
      name: "Supra",
      pair: "HBAR / USDT",
      role: "the cross-check",
      price: supra?.price,
      at: supraAt ? Number(supraAt) : undefined,
    },
  ];

  return (
    <section aria-labelledby="oracle-title" className="mx-auto w-full max-w-6xl px-5 pt-16">
      <h2 id="oracle-title" className="text-3xl font-normal tracking-[-0.01em]">
        Prices the keeper trusts
      </h2>
      <p className="mt-3 mb-8 max-w-2xl text-base-content/70">
        Each check asks PriceGuard first. Chainlink is the price, Supra is the independent check, and the keeper only
        liquidates when both are fresh and close. Read live from PriceGuard on chain.
      </p>

      {isError && !guard && (
        <p role="alert" className="mb-4 rounded-box bg-error/15 p-4 text-sm">
          Couldn&apos;t read PriceGuard. Retrying every 30 seconds.
        </p>
      )}

      <div className="grid gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 md:grid-cols-3">
        {feeds.map(feed => {
          const age = feed.at && now !== undefined ? Math.max(0, now - feed.at) : undefined;
          const stale = age !== undefined && maxAge !== undefined && age > maxAge;
          return (
            <div key={feed.name} className="bg-base-100 p-6">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="m-0 text-lg font-normal">{feed.name}</h3>
                <span className="text-sm text-base-content/60">{feed.pair}</span>
              </div>
              <div className="mt-3 text-4xl tabular-nums">{feed.price ? `$${feed.price.toFixed(5)}` : "—"}</div>
              <div className={`mt-1 text-sm ${stale ? "text-error" : "text-base-content/60"}`}>
                {age !== undefined ? `Updated ${ago(age)}` : "Reading the feed…"}, {feed.role}
              </div>
              <progress
                className={`progress mt-4 h-1.5 w-full ${stale ? "progress-error" : "progress-success"}`}
                value={age !== undefined && maxAge ? Math.min(age, maxAge) : undefined}
                max={maxAge ?? 1}
                aria-label={`${feed.name} age, out of the ${maxAge ? maxAge / 60 : "…"} minute limit`}
              />
              <div className="mt-1 text-xs text-base-content/55">
                max age {maxAge !== undefined ? `${maxAge / 60} min` : "…"}
              </div>
            </div>
          );
        })}

        <div className="bg-base-100 p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="m-0 text-lg font-normal">PriceGuard</h3>
            {verdict ? (
              <span className={`badge ${verdict.tone} badge-lg`}>{verdict.label}</span>
            ) : (
              <span className="text-sm text-base-content/60">Reading…</span>
            )}
          </div>
          <div className="mt-3 text-4xl tabular-nums">
            {deviationBps !== undefined ? `${(Number(deviationBps) / 100).toFixed(2)}%` : "—"}
          </div>
          <div className="mt-1 text-sm text-base-content/60">apart</div>
          <progress
            className={`progress mt-4 h-1.5 w-full ${status === 2 ? "progress-error" : "progress-success"}`}
            value={
              deviationBps !== undefined && maxDeviationBps
                ? Number(deviationBps > maxDeviationBps ? maxDeviationBps : deviationBps)
                : undefined
            }
            max={maxDeviationBps ? Number(maxDeviationBps) : 1}
            aria-label="How far apart the feeds are, out of the limit"
          />
          <div className="mt-1 text-xs text-base-content/55">
            limit {maxDeviationBps !== undefined ? `${Number(maxDeviationBps) / 100}%` : "…"}
          </div>
        </div>
      </div>
      <p className={`mt-4 mb-0 ${status === 0 ? "text-base-content/80" : "text-base-content"}`} role="status">
        {verdict?.text ?? "Reading PriceGuard on Hedera…"}
      </p>
    </section>
  );
};
