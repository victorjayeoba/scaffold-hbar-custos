"use client";

import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { fmtUsdc, shortAddress } from "~~/app/pool/_lib/format";
import { type PoolFlow, usePoolEarnings } from "~~/hooks/custos/usePoolEarnings";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";

const RECENT = 8;

const signed = (v: bigint) => `${v > 0n ? "+" : v < 0n ? "−" : ""}${fmtUsdc(v < 0n ? -v : v)}`;
// The theme's success/error tints are too light for text on white; darker shades in light mode keep 4.5:1 contrast.
const tone = (v: bigint) =>
  v > 0n ? "text-emerald-700 dark:text-success" : v < 0n ? "text-red-700 dark:text-error" : "";

const flowText = (f: PoolFlow) => {
  const who = f.trader ? shortAddress(f.trader) : "";
  switch (f.kind) {
    case "fee":
      return `Open fee from ${who}`;
    case "settled":
      return f.amount >= 0n ? `${who} closed at a loss` : `${who} closed in profit, paid by the pool`;
    case "liquidation":
      return `${who} liquidated${f.byNetwork ? " by the network" : ""}, collateral to the pool`;
    case "keeper":
      return "Paid the network keeper (swapped to HBAR for scheduled checks)";
    case "deposit":
      return `${who} deposited`;
    case "withdraw":
      return `${who} withdrew`;
  }
};

const when = (timestamp: string) =>
  new Date(Number(timestamp.split(".")[0]) * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

/** Where the pool's money came from, rebuilt from on-chain events, and checked against its balance. */
export const PoolEarningsCard = ({ usdcHeld }: { usdcHeld?: bigint }) => {
  const { data, isLoading, isError } = usePoolEarnings();
  const { targetNetwork } = useTargetNetwork();
  const explorer = targetNetwork.blockExplorers?.default.url ?? "https://hashscan.io/testnet";

  const rows = data
    ? [
        { label: "Trading fees", note: "0.1% of size on open and close", value: data.fees },
        {
          label: "Liquidations",
          note: "Collateral of positions that fell under margin",
          value: data.liquidations,
        },
        {
          label: "Settled trades",
          note: "Trader losses minus profits, funding included",
          value: data.settled,
        },
        {
          label: "Keeper fees",
          note: "Spare USDC swapped to HBAR so Hedera keeps running the checks",
          value: -data.keeperPaid,
        },
      ]
    : [];

  // Every USDC movement has an event, so LP money in − out + net should equal the balance on chain.
  const expected = data ? data.deposited - data.withdrawn + data.net : undefined;
  const gap = expected !== undefined && usdcHeld !== undefined ? usdcHeld - expected : undefined;
  const reconciles = gap !== undefined && (gap < 0n ? -gap : gap) <= 10n; // ≤ 0.00001 USDC of rounding
  const recent = data?.flows.slice(0, RECENT) ?? [];

  return (
    <div>
      <h2 id="pool-earnings-heading" className="m-0 text-3xl font-normal tracking-[-0.01em]">
        Where the pool&apos;s money comes from
      </h2>
      <p className="mt-3 mb-8 max-w-2xl text-base-content/70">
        Rebuilt from every PerpMarket and LiquidityPool event on the Hedera mirror node, so each number traces back to a
        transaction.
      </p>

      {isError ? (
        <p role="alert" className="m-0 rounded-box border border-error/40 bg-base-100 p-6">
          Couldn&apos;t reach the mirror node for the pool&apos;s history. It retries every 30 seconds.
        </p>
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Loading pool history">
          <div className="h-64 animate-pulse rounded-box bg-base-100" />
          <div className="h-64 animate-pulse rounded-box bg-base-100" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
            <dl className="m-0 divide-y divide-base-300">
              {rows.map(r => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 py-3 first:pt-0">
                  <dt>
                    <div>{r.label}</div>
                    <div className="text-xs text-base-content/60">{r.note}</div>
                  </dt>
                  <dd className={`m-0 shrink-0 tabular-nums ${tone(r.value)}`}>{signed(r.value)}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 pt-3">
                <dt className="text-lg">Net for LPs</dt>
                <dd className={`m-0 text-lg tabular-nums ${tone(data.net)}`}>{signed(data.net)} USDC</dd>
              </div>
            </dl>
            <p className="mt-6 mb-0 text-sm text-base-content/70">
              LPs put in {fmtUsdc(data.deposited)} USDC and took out {fmtUsdc(data.withdrawn)}.{" "}
              {gap === undefined
                ? ""
                : reconciles
                  ? "With the net above, that matches the USDC the pool holds on chain."
                  : `With the net above, that is ${fmtUsdc(gap < 0n ? -gap : gap)} USDC ${gap > 0n ? "below" : "above"} the pool's balance (USDC sent to the pool directly, or history not fully read).`}
            </p>
            {(data.truncated || data.unmatched > 0) && (
              <p className="mt-2 mb-0 text-xs text-base-content/60">
                {data.truncated && "Only the oldest part of a long history was read. "}
                {data.unmatched > 0 &&
                  `${data.unmatched} close or liquidation had no matching open in the history read, so it counts as 0.`}
              </p>
            )}
          </div>

          <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
            <h3 className="m-0 text-lg font-normal">Recent money in and out</h3>
            {recent.length === 0 ? (
              <p className="mt-4 mb-0 text-base-content/70">
                Nothing yet. Fees and liquidations appear here as traders use the market.
              </p>
            ) : (
              <ul className="m-0 mt-4 list-none divide-y divide-base-300 p-0">
                {recent.map(f => (
                  <li
                    key={`${f.timestamp}-${f.kind}-${f.trader ?? ""}`}
                    className="grid grid-cols-[1fr_auto] gap-x-4 py-3"
                  >
                    <span className="min-w-0 text-sm">
                      {flowText(f)}
                      <a
                        href={`${explorer}/transaction/${f.timestamp}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link mt-0.5 flex items-center gap-1 text-xs text-base-content/60"
                      >
                        {when(f.timestamp)} UTC
                        <ArrowTopRightOnSquareIcon className="h-3 w-3" aria-hidden />
                        <span className="sr-only">(opens HashScan)</span>
                      </a>
                    </span>
                    <span className={`text-sm tabular-nums ${tone(f.amount)}`}>{signed(f.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
