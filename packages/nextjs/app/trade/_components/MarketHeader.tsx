"use client";

import Link from "next/link";
import { fmtBps, fmtDuration, fmtPrice, fmtRate, fmtUsdc } from "../_lib/format";
import { useKeeper } from "~~/hooks/custos/useKeeper";
import { countdown } from "~~/hooks/custos/useNow";
import { usePriceFeeds } from "~~/hooks/custos/usePriceFeeds";
import type { TradeMarket } from "~~/hooks/custos/useTradeMarket";
import { BPS } from "~~/utils/custos/perpMath";

type Verdict = { tone: "ok" | "warn" | "bad"; title: string; body: string };

/**
 * Explains PriceGuard's status in words, using the same inputs and limits the contract used for this read.
 * Exported so the panels can reuse the one-line reason.
 */
export const explainGuard = (market: TradeMarket, now?: number): Verdict | undefined => {
  const g = market.guard;
  if (!g) return undefined;
  const limitAge = market.maxStaleness;
  const limitDev = market.maxDeviationBps;
  const age = (at: number) => (now && at ? Math.max(0, now - at) : undefined);
  const clAge = age(g.chainlinkAt);
  const suAge = age(g.supraAt);

  if (g.status === "ok") {
    // Warn before a feed ages out: the market goes close-only the moment it does.
    const oldest = Math.max(clAge ?? 0, suAge ?? 0);
    if (limitAge && oldest > limitAge - 15 * 60) {
      const who = (clAge ?? 0) >= (suAge ?? 0) ? "Chainlink" : "Supra";
      return {
        tone: "warn",
        title: "Open, but a price is getting old",
        body: `${who}'s last update is ${fmtDuration(oldest)} old. If it doesn't update within ${fmtDuration(
          Math.max(0, limitAge - oldest),
        )}, the market turns close-only until it does.`,
      };
    }
    return {
      tone: "ok",
      title: "Open",
      body: `Chainlink and Supra are both fresh and ${fmtBps(g.deviationBps)} apart (limit ${fmtBps(
        limitDev,
      )}). You can open, close and add collateral, and the network liquidates on schedule.`,
    };
  }

  const tail = `New positions can't open and the network skips liquidations until it clears. You can still close a position (${
    market.worseFeedClose ? "at whichever of the two prices is worse for you" : "at Chainlink's last price"
  }) or add collateral.`;

  if (g.status === "deviated") {
    return {
      tone: "bad",
      title: "Close-only: the two prices disagree",
      body: `Chainlink and Supra are ${fmtBps(g.deviationBps)} apart, more than the ${fmtBps(
        limitDev,
      )} PriceGuard allows. ${tail}`,
    };
  }

  // Stale: name which feed, and why.
  const reasons: string[] = [];
  if (g.price === 0n || !g.chainlinkAt) reasons.push("Chainlink isn't returning a price");
  else if (limitAge && clAge !== undefined && clAge > limitAge)
    reasons.push(`Chainlink's last price is ${fmtDuration(clAge)} old`);
  if (!g.supraAt) reasons.push("Supra isn't returning a price");
  else if (limitAge && suAge !== undefined && suAge > limitAge)
    reasons.push(`Supra's last price is ${fmtDuration(suAge)} old`);
  const why = reasons.length ? `${reasons.join(" and ")}` : "A price feed is out of date";
  return {
    tone: "bad",
    title: "Close-only: a price is out of date",
    body: `${why}${limitAge ? ` (the limit is ${fmtDuration(limitAge)})` : ""}. ${tail}${
      g.price === 0n && !market.worseFeedClose ? " With no Chainlink price at all, closing waits too." : ""
    }`,
  };
};

const toneClass = {
  ok: "border-success/40 bg-success/10",
  warn: "border-warning/60 bg-warning/15",
  bad: "border-error/60 bg-error/10",
} as const;

const dot = { ok: "bg-success", warn: "bg-warning", bad: "bg-error" } as const;

/** HBAR-USD mark price from PriceGuard, the Supra cross-check, market status, funding and open interest. */
export const MarketHeader = ({ market, now }: { market: TradeMarket; now?: number }) => {
  const { supra } = usePriceFeeds();
  const keeper = useKeeper();
  const g = market.guard;
  const verdict = explainGuard(market, now);

  if (market.guardError && !g) {
    return (
      <section aria-label="Market" className="rounded-box border border-error/60 bg-base-100 p-6">
        <p className="m-0 text-lg">Can&apos;t read the price right now.</p>
        <p className="mb-0 text-base-content/70">
          The Hedera RPC didn&apos;t answer. The page retries every 30 seconds; trading is disabled until it does.
        </p>
      </section>
    );
  }

  const fundingSide =
    market.fundingRate === undefined
      ? undefined
      : market.fundingRate === 0n
        ? "Balanced: no one pays"
        : market.fundingRate > 0n
          ? `Longs pay shorts ${fmtRate(market.fundingRate)} an hour`
          : `Shorts pay longs ${fmtRate(-market.fundingRate)} an hour`;

  const cap =
    market.poolBalance !== undefined && market.params
      ? (market.poolBalance * market.params.maxOpenInterestBps) / BPS
      : undefined;
  const capUsedPct =
    cap && market.openInterest !== undefined && cap > 0n ? Number((market.openInterest * BPS) / cap) / 100 : 0;

  const nextCheck = keeper.nextRunAt && now ? keeper.nextRunAt - now : undefined;

  return (
    <section aria-label="Market" className="rounded-box border border-base-300 bg-base-100">
      <div className="grid gap-6 p-5 sm:p-6">
        <div>
          <div className="text-sm text-base-content/60">HBAR-USD mark price</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-4xl tabular-nums sm:text-5xl" aria-live="polite">
              {g ? g.price > 0n ? `$${fmtPrice(g.price)}` : "No price" : <Skeleton className="h-11 w-48" />}
            </span>
            {verdict && (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <span className={`h-2 w-2 rounded-full ${dot[verdict.tone]}`} aria-hidden />
                {g?.status === "ok" ? "Open" : "Close-only"}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-base-content/60">
            Chainlink HBAR/USD through PriceGuard: the exact price the contract trades at.
          </div>
        </div>

        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-base-300 pt-5 text-sm md:grid-cols-4">
          <Stat label="Supra check (HBAR/USDT)">
            {supra ? `$${supra.price.toFixed(5)}` : "—"}
            <Sub>{g && g.deviationBps !== undefined ? `${fmtBps(g.deviationBps)} apart` : " "}</Sub>
          </Stat>
          <Stat label="Price ages">
            {g && now ? (
              <>
                Chainlink {g.chainlinkAt ? fmtDuration(now - g.chainlinkAt) : "—"}
                <Sub>Supra {g.supraAt ? fmtDuration(now - g.supraAt) : "—"}</Sub>
              </>
            ) : (
              "—"
            )}
          </Stat>
          <Stat label="Funding">
            {fundingSide ?? "—"}
            <Sub>From the long/short skew</Sub>
          </Stat>
          <Stat label="Open interest">
            {market.openInterest !== undefined && cap !== undefined
              ? `${fmtUsdc(market.openInterest)} of ${fmtUsdc(cap)}`
              : "—"}
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-base-300"
              role="meter"
              aria-label="Open interest used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(capUsedPct)}
            >
              <div className="h-full bg-primary" style={{ width: `${Math.min(100, capUsedPct)}%` }} />
            </div>
            <Sub>
              {cap !== undefined && market.openInterest !== undefined && market.openInterest >= cap
                ? "Full: no room for new positions"
                : "USDC, capped at half the pool"}
            </Sub>
          </Stat>
        </dl>
      </div>

      {verdict && (
        <div
          role={verdict.tone === "ok" ? undefined : "status"}
          className={`mx-5 mb-5 rounded-box border px-4 py-3 text-sm sm:mx-6 ${toneClass[verdict.tone]}`}
        >
          <span className="font-medium">{verdict.title}.</span> <span>{verdict.body}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-5 py-3 text-sm text-base-content/70 sm:px-6">
        <span>
          {nextCheck === undefined
            ? "Reading the network's schedule…"
            : nextCheck > 0
              ? `Next network check in ${countdown(nextCheck)}: it charges funding and liquidates anyone under margin.`
              : keeper.interval !== undefined && -nextCheck > 2 * keeper.interval
                ? "The network's checks have stopped: no liquidations or funding until someone revives the keeper."
                : "A network check is due now."}
        </span>
        <Link href="/keeper" className="link">
          Watch the keeper
        </Link>
      </div>
    </section>
  );
};

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-base-content/60">{label}</dt>
    <dd className="m-0 mt-0.5 tabular-nums">{children}</dd>
  </div>
);

const Sub = ({ children }: { children: React.ReactNode }) => (
  <div className="text-xs text-base-content/60">{children}</div>
);

export const Skeleton = ({ className = "" }: { className?: string }) => (
  <span className={`inline-block animate-pulse rounded bg-base-300 align-middle ${className}`} aria-hidden />
);
