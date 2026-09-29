"use client";

import { ago, useNow } from "~~/hooks/custos/useNow";
import { MAX_DEVIATION_BPS, MAX_STALENESS_SECONDS, usePriceFeeds } from "~~/hooks/custos/usePriceFeeds";

const verdict = {
  loading: { text: "Reading both feeds on Hedera testnet…", tone: "text-base-content/60" },
  ok: { text: "Prices agree. Trading and liquidations are open.", tone: "text-success" },
  stale: {
    text: "A feed is more than two hours old. The market is close-only and the keeper skips liquidations.",
    tone: "text-warning",
  },
  deviated: {
    text: "The feeds disagree by more than 5%. The market is close-only and the keeper skips liquidations.",
    tone: "text-error",
  },
} as const;

/** Live Chainlink and Supra prices, and the rule PriceGuard applies to them. */
export const OracleReadout = () => {
  const now = useNow();
  const { chainlink, supra, deviationBps, status } = usePriceFeeds();

  const rows = [
    { name: "Chainlink", pair: "HBAR / USD", role: "The price every trade and liquidation uses", feed: chainlink },
    { name: "Supra", pair: "HBAR / USDT", role: "The independent check", feed: supra },
  ];

  return (
    <div>
      <dl className="grid gap-px overflow-hidden rounded-box bg-base-300 sm:grid-cols-2">
        {rows.map(({ name, pair, role, feed }) => (
          <div key={name} className="bg-base-100 p-6">
            <dt className="flex items-baseline justify-between gap-4">
              <span className="text-lg">{name}</span>
              <span className="text-sm text-base-content/60">{pair}</span>
            </dt>
            <dd className="m-0">
              <div className="mt-3 text-4xl tabular-nums">{feed ? `$${feed.price.toFixed(5)}` : "—"}</div>
              <div className="mt-1 text-sm text-base-content/60">
                {feed && now ? `Updated ${ago(Math.max(0, now - feed.updatedAt))}` : "Waiting for the feed"}. {role}.
              </div>
            </dd>
          </div>
        ))}
      </dl>
      <p className={`mt-4 mb-0 ${verdict[status].tone}`}>
        {verdict[status].text}
        {deviationBps !== undefined && (
          <span className="text-base-content/60">
            {" "}
            They are {(deviationBps / 100).toFixed(2)}% apart (limit {MAX_DEVIATION_BPS / 100}%, max age{" "}
            {MAX_STALENESS_SECONDS / 60} min).
          </span>
        )}
      </p>
    </div>
  );
};
