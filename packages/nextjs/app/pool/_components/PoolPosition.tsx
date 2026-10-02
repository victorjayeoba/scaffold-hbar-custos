"use client";

import { PoolConnectGate } from "./PoolConnectGate";
import { fmt, fmtUsdc, pct } from "~~/app/pool/_lib/format";
import type { Association } from "~~/hooks/custos/useHtsToken";
import type { PoolState } from "~~/hooks/custos/usePool";

const associationText: Record<Association, string> = {
  loading: "Checking…",
  associated: "Associated",
  auto: "Associates on first receipt",
  "not-associated": "Not associated yet",
  "no-account": "No Hedera account yet",
  "not-required": "No association needed",
  unknown: "Couldn't check",
};

/** The connected LP's stake: shares, what they're worth, and how much of it can leave right now. */
export const PoolPosition = ({
  pool,
  connected,
  wrongNetwork,
}: {
  pool: PoolState;
  connected: boolean;
  wrongNetwork: boolean;
}) => {
  const { shares, usdc, me } = pool;
  const symbol = shares.symbol ?? "cUSDC-LP";
  const capped = me.value !== undefined && me.maxWithdraw !== undefined && me.maxWithdraw < me.value;
  const lockedForYou = capped ? me.value! - me.maxWithdraw! : 0n;

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
      <h2 className="m-0 text-2xl font-normal">Your share</h2>

      {!connected || wrongNetwork ? (
        <div className="mt-6">
          <PoolConnectGate wrongNetwork={wrongNetwork} what="to see your shares and what they're worth" />
        </div>
      ) : shares.balance === undefined ? (
        <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading your share">
          <div className="h-10 w-48 animate-pulse rounded bg-base-300" />
          <div className="h-4 w-64 animate-pulse rounded bg-base-300" />
        </div>
      ) : shares.balance === 0n ? (
        <p className="mt-6 mb-0 text-base-content/70">
          You don&apos;t hold any pool shares yet. Deposit USDC to become a liquidity provider.
        </p>
      ) : (
        <>
          <div className="mt-6 text-4xl tabular-nums">
            {fmtUsdc(me.value)}
            <span className="ml-2 text-base text-base-content/60">USDC</span>
          </div>
          <p className="mt-1 mb-0 text-sm text-base-content/70 tabular-nums">
            {fmt(shares.balance, shares.decimals ?? 6, 4)} {symbol}
            {pct(shares.balance, shares.totalSupply, 2) !== undefined &&
              ` · ${pct(shares.balance, shares.totalSupply, 2)}% of the pool`}
          </p>

          <dl className="m-0 mt-6 divide-y divide-base-300 border-y border-base-300">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
              <dt>Can withdraw now</dt>
              <dd className="m-0 tabular-nums">{fmtUsdc(me.maxWithdraw)} USDC</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
              <dt>Can redeem now</dt>
              <dd className="m-0 tabular-nums">
                {fmt(me.maxRedeem, shares.decimals ?? 6, 4)} {symbol}
              </dd>
            </div>
          </dl>

          {capped && (
            <p className="mt-4 mb-0 rounded-box bg-warning/15 p-4 text-sm leading-relaxed">
              {fmtUsdc(lockedForYou)} USDC of your share is backing open positions, so it can&apos;t leave yet.
              Withdrawals stop at the pool&apos;s free USDC ({fmtUsdc(pool.freeAssets)} USDC now): the pool keeps twice
              the open interest so winning traders always get paid. It frees up as positions close.
            </p>
          )}
        </>
      )}

      {connected && !wrongNetwork && (
        <dl className="m-0 mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-base-content/70">USDC in wallet</dt>
          <dd className="m-0 text-right tabular-nums">
            {usdc.balance === undefined ? "…" : `${fmtUsdc(usdc.balance)}`}
          </dd>
          <dt className="text-base-content/70">USDC token</dt>
          <dd className="m-0 text-right">{associationText[usdc.association]}</dd>
          <dt className="text-base-content/70">Share token</dt>
          <dd className="m-0 text-right">{associationText[shares.association]}</dd>
        </dl>
      )}
    </div>
  );
};
