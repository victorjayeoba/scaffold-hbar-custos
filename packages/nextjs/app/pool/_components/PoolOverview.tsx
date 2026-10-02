"use client";

import { fmtUsdc, pct } from "~~/app/pool/_lib/format";
import type { PoolState } from "~~/hooks/custos/usePool";

const BPS = 10_000n;

/** The pool at a glance: what it holds, what's free, and how much of it open positions are using. */
export const PoolOverview = ({ pool }: { pool: PoolState }) => {
  const { totalAssets, freeAssets, requiredLiquidity, openInterest, longNotional, shortNotional, sharePrice } = pool;

  if (pool.error && !pool.loaded) {
    return (
      <div role="alert" className="rounded-box border border-error/40 bg-base-100 p-6">
        <p className="m-0 text-lg">Couldn&apos;t read the pool from Hedera testnet.</p>
        <p className="mt-2 mb-0 text-base-content/70">
          The public RPC may be busy. This page retries every 30 seconds.
        </p>
      </div>
    );
  }

  // New positions may use at most MAX_OPEN_INTEREST_BPS of the pool's USDC.
  const capacity =
    pool.usdcHeld !== undefined && openInterest !== undefined && pool.maxOpenInterestBps !== undefined
      ? (() => {
          // PerpMarket caps open interest against the pool's USDC balance.
          const cap = (pool.usdcHeld * pool.maxOpenInterestBps) / BPS;
          return cap > openInterest ? cap - openInterest : 0n;
        })()
      : undefined;
  // freeAssets = USDC held − requiredLiquidity, so utilisation is measured against the cash balance.
  const used = pct(requiredLiquidity, pool.usdcHeld);
  const usedNumber = used === undefined ? 0 : Math.min(100, Number(used));

  const stats = [
    {
      label: "Pool value",
      value: totalAssets,
      unit: "USDC",
      note: "What all LP shares are worth together.",
    },
    {
      label: "Share price",
      value: sharePrice,
      digits: 4,
      unit: "USDC",
      note: "What one cUSDC-LP share redeems for.",
    },
    {
      label: "Free to withdraw",
      value: freeAssets,
      unit: "USDC",
      note: "What LPs can take out right now.",
    },
    {
      label: "Backing open positions",
      value: requiredLiquidity,
      unit: "USDC",
      note: "Twice the open interest, held so winners always get paid.",
    },
  ];

  return (
    <div className="rounded-box border border-base-300 bg-base-100">
      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-t-box bg-base-300 lg:grid-cols-4">
        {stats.map(s => (
          <div key={s.label} className="bg-base-100 p-5 sm:p-6">
            <dt className="text-sm text-base-content/70">{s.label}</dt>
            <dd className="m-0">
              <div className="mt-2 text-2xl tabular-nums sm:text-3xl" aria-live="polite">
                {s.value === undefined ? (
                  <span className="inline-block h-8 w-24 animate-pulse rounded bg-base-300" aria-label="Loading" />
                ) : (
                  <>
                    {fmtUsdc(s.value, s.digits ?? 2)}
                    <span className="ml-1.5 text-sm text-base-content/60">{s.unit}</span>
                  </>
                )}
              </div>
              <p className="mt-1 mb-0 text-xs leading-snug text-base-content/60">{s.note}</p>
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-base-300 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span id="pool-utilisation-label" className="text-sm">
            Utilisation{" "}
            <span className="tabular-nums text-base-content/70">{used === undefined ? "…" : `${used}%`}</span>
          </span>
          <span className="text-sm text-base-content/70 tabular-nums">
            Open interest {fmtUsdc(openInterest)} USDC
            {longNotional !== undefined && shortNotional !== undefined && (
              <>
                {" "}
                ({fmtUsdc(longNotional)} long · {fmtUsdc(shortNotional)} short)
              </>
            )}
          </span>
        </div>
        <div
          role="meter"
          aria-labelledby="pool-utilisation-label"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usedNumber}
          aria-valuetext={used === undefined ? "Loading" : `${used}% of the pool is backing open positions`}
          className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-base-300"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${usedNumber}%` }} />
        </div>
        <p className="mt-3 mb-0 text-sm text-base-content/70">
          {capacity === undefined
            ? "Reading open interest…"
            : `Traders can open up to ${fmtUsdc(capacity)} USDC more in positions. Open interest may use at most ${Number(pool.maxOpenInterestBps) / 100}% of the pool.`}
        </p>
      </div>
    </div>
  );
};
