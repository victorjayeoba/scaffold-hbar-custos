"use client";

import { ago, useNow } from "~~/hooks/custos/useNow";
import { fmtMaxAge, usePriceFeeds } from "~~/hooks/custos/usePriceFeeds";

const ending = "The market is close-only and the keeper skips liquidations.";
/** What PriceGuard's rule says, with its limits as read from the contract ("…" until they load). */
const verdictFor = (status: ReturnType<typeof usePriceFeeds>["status"], maxAge: string, maxDev: string) =>
  ({
    loading: { text: "Reading both feeds on Hedera testnet…", tone: "text-base-content/60" },
    ok: { text: "Prices agree. Trading and liquidations are open.", tone: "text-success" },
    stale: { text: `A feed is more than ${maxAge} old. ${ending}`, tone: "text-warning" },
    deviated: { text: `The feeds disagree by more than ${maxDev}. ${ending}`, tone: "text-error" },
  })[status];

/** Live Chainlink and Supra prices, and the rule PriceGuard applies to them. */
export const OracleReadout = () => {
  const now = useNow();
  const { chainlink, supra, deviationBps, status, maxStaleness, maxDeviationBps } = usePriceFeeds();
  const maxAge = maxStaleness !== undefined ? fmtMaxAge(maxStaleness) : "…";
  const maxDev = maxDeviationBps !== undefined ? `${maxDeviationBps / 100}%` : "…";
  const verdict = verdictFor(status, maxAge, maxDev);

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
      <p className={`mt-4 mb-0 ${verdict.tone}`}>
        {verdict.text}
        {deviationBps !== undefined && (
          <span className="text-base-content/60">
            {" "}
            They are {(deviationBps / 100).toFixed(2)}% apart (limit {maxDev}, max age {maxAge}, both read from
            PriceGuard).
          </span>
        )}
      </p>
    </div>
  );
};
