"use client";

import { ExternalLink } from "./KeeperHeartbeat";
import { hbar, shortAddress, utcDay, utcTime } from "./format";
import { formatUnits } from "viem";
import {
  type KeeperEntry,
  type MarketEvent,
  hederaIdOf,
  useHederaLinks,
  useKeeperActivity,
} from "~~/hooks/custos/useKeeperActivity";

const usd = (price: bigint) => `$${Number(formatUnits(price, 18)).toFixed(5)}`;
const usdc = (amount: bigint) =>
  `${Number(formatUnits(amount, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;

/** Hedera response codes a failed scheduled run is likely to hit, in plain words. */
const FAILURES: Record<string, string> = {
  INSUFFICIENT_PAYER_BALANCE: "The fee reserve couldn't cover the gas Hedera holds before a run.",
  INSUFFICIENT_GAS: "The run ran out of gas.",
  CONTRACT_REVERT_EXECUTED: "tick() reverted.",
};

const Address = ({ address, hashscan }: { address: string; hashscan: string }) => (
  <a href={`${hashscan}/account/${address}`} target="_blank" rel="noreferrer" className="link font-mono">
    {shortAddress(address)}
  </a>
);

/** A one-line description of one event, or null for events that aren't the keeper's business. */
const describe = (event: MarketEvent, hashscan: string): React.ReactNode => {
  switch (event.eventName) {
    case "FundingAccrued": {
      const pct = Number(event.args.ratePerHour) / 1e16;
      if (pct === 0) return <>Funding charged: none, open interest is balanced</>;
      return (
        <>
          Funding charged {Math.abs(pct).toFixed(4)}%/h, {pct > 0 ? "longs pay shorts" : "shorts pay longs"}
        </>
      );
    }
    case "Swept": {
      const { from, to, liquidated } = event.args;
      const n = Number(liquidated);
      if (from === to && n === 0) return <>Swept the book: no open positions to check</>;
      return (
        <>
          Swept the book up to trader #{Number(to)}, {n === 0 ? "none underwater" : `${n} liquidated`}
        </>
      );
    }
    case "SweepSkipped":
      return (
        <span className="text-warning-content dark:text-warning">
          Skipped liquidations: {event.args.status === 1 ? "a price feed was stale" : "the price feeds disagreed"}. The
          market was close-only.
        </span>
      );
    case "Liquidated": {
      const { trader, price, byNetwork, by, reward } = event.args;
      return (
        <>
          <strong className="font-medium">Liquidated</strong> <Address address={trader} hashscan={hashscan} /> at{" "}
          {usd(price)}{" "}
          {byNetwork ? (
            <span className="badge badge-sm border-0 bg-[#5eead4] text-black">run by the network, no signer</span>
          ) : (
            <>
              by <Address address={by} hashscan={hashscan} />, reward {usdc(reward)}
            </>
          )}
        </>
      );
    }
    case "Refueled": {
      const { usdcIn, hbarOut, runsBefore } = event.args;
      return (
        <>
          Refuelled: swapped {usdc(usdcIn)} for {hbar(hbarOut)} HBAR on SaucerSwap ({Number(runsBefore)} runs were left)
        </>
      );
    }
    case "TickScheduled": {
      const id = hederaIdOf(event.args.schedule);
      const at = Number(event.args.at);
      return (
        <>
          Booked the next check for {utcTime(at)} UTC
          {id && (
            <>
              {" "}
              as{" "}
              <a href={`${hashscan}/schedule/${id}`} target="_blank" rel="noreferrer" className="link font-mono">
                {id}
              </a>
            </>
          )}
        </>
      );
    }
    case "ScheduleFailed": {
      const rc = Number(event.args.responseCode);
      return (
        <span className="text-error">
          Couldn&apos;t book the next check
          {rc === -1 ? ": every second tried was full" : ` (response code ${rc})`}
        </span>
      );
    }
    case "Revived":
      return (
        <>
          Chain restarted by <Address address={event.args.by} hashscan={hashscan} />
        </>
      );
    case "Funded":
      return (
        <>
          {hbar(event.args.amount)} HBAR added to the reserve by{" "}
          <Address address={event.args.from} hashscan={hashscan} />
        </>
      );
    case "Stopped":
      return <>The chain stopped after {Number(event.args.runs)} runs</>;
    case "Ticked":
      return event.args.workOk ? null : (
        <span className="text-warning">The job reverted; the next check was still booked</span>
      );
    default:
      return null;
  }
};

const titleOf = (entry: KeeperEntry) => {
  const tick = entry.events.find(e => e.eventName === "Ticked");
  if (tick?.eventName === "Ticked") return `Check ${tick.args.run} ran`;
  if (entry.scheduled && entry.result !== "SUCCESS") return "A booked check failed";
  const names = new Set(entry.events.map(e => e.eventName));
  if (names.has("Revived")) return "Keeper revived";
  if (names.has("Liquidated")) return "Liquidation";
  if (names.has("Refueled")) return "Reserve refuelled";
  if (names.has("Funded")) return "Reserve topped up";
  return "Keeper activity";
};

const Entry = ({ entry, hashscan }: { entry: KeeperEntry; hashscan: string }) => {
  const seconds = Number(entry.timestamp.split(".")[0]);
  const failed = entry.result !== undefined && entry.result !== "SUCCESS";
  const networkLiquidation = entry.events.some(e => e.eventName === "Liquidated" && e.args.byNetwork);
  // A refuel's swap pays HBAR into receive(), which also emits Funded; the Refueled line already says it.
  const refueled = entry.events.some(e => e.eventName === "Refueled");
  const lines = entry.events
    .filter(e => !(refueled && e.eventName === "Funded"))
    .map(event => describe(event, hashscan))
    .filter(line => line !== null);

  return (
    <li
      className={`grid gap-x-6 gap-y-2 border-l-4 py-5 pl-4 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:pl-5 ${
        failed ? "border-error" : networkLiquidation ? "border-[#5eead4]" : "border-transparent"
      }`}
    >
      <div className="tabular-nums">
        <time dateTime={new Date(seconds * 1000).toISOString()}>
          <span className="text-base">{utcTime(seconds)}</span>{" "}
          <span className="text-sm text-base-content/60 sm:block">{utcDay(seconds)} UTC</span>
        </time>
      </div>
      <div className="min-w-0">
        <h3 className="m-0 text-lg font-normal">{titleOf(entry)}</h3>
        {failed && (
          <p className="mt-1 mb-0 text-error">
            Hedera fired the booked call and it failed: <code className="text-sm">{entry.result}</code>.{" "}
            {entry.result ? FAILURES[entry.result] : ""}
          </p>
        )}
        {lines.length > 0 && (
          <ul className="mt-1 mb-0 list-none space-y-1 p-0 text-base-content/80">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-base-content/60">
          {entry.scheduled ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#5eead4]" aria-hidden />
              Executed by the Schedule Service, no signer
            </span>
          ) : entry.scheduled === false ? (
            <span>Sent from a wallet</span>
          ) : null}
          {entry.feePaidByContract !== undefined && (
            <span>Fee {hbar(entry.feePaidByContract)} HBAR, paid by the contract</span>
          )}
        </div>
      </div>
      <div className="sm:text-right">
        <ExternalLink
          href={`${hashscan}/transaction/${entry.timestamp}`}
          label={`${titleOf(entry)}, ${utcTime(seconds)} UTC, on HashScan`}
        >
          HashScan
        </ExternalLink>
      </div>
    </li>
  );
};

/** Everything the keeper did, newest first: from the Hedera mirror node, decoded against PerpMarket's ABI. */
export const KeeperActivity = () => {
  const { hashscan } = useHederaLinks();
  const { entries, error, isLoading, hasMore, loadMore, isLoadingMore, retry } = useKeeperActivity();
  const networkRuns = entries?.filter(e => e.scheduled).length ?? 0;

  return (
    <section aria-labelledby="activity-title" className="mx-auto w-full max-w-6xl px-5 py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="activity-title" className="m-0 text-3xl font-normal tracking-[-0.01em]">
          What the network did
        </h2>
        {entries && entries.length > 0 && (
          <span className="text-sm text-base-content/60">
            {networkRuns} of {entries.length} shown were executed by the network
          </span>
        )}
      </div>
      <p className="mt-3 mb-8 max-w-2xl text-base-content/70">
        Read from the Hedera mirror node, newest first. Rows marked with a teal dot were executed by the Schedule
        Service from a booking: no person or server signed them, and the contract paid the fee.
      </p>

      <div className="rounded-box border border-base-300 bg-base-100 px-2 sm:px-4" aria-busy={isLoading}>
        {isLoading && (
          <ul className="m-0 list-none divide-y divide-base-300 p-0" aria-label="Loading keeper activity">
            {[0, 1, 2].map(i => (
              <li key={i} className="flex gap-6 py-6 pl-4">
                <div className="h-5 w-24 animate-pulse rounded bg-base-300" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-40 animate-pulse rounded bg-base-300" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-base-300" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {!isLoading && error && !entries && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-4 p-6">
            <p className="m-0">Couldn&apos;t read the mirror node: {error.message}</p>
            <button type="button" className="btn btn-sm rounded-full" onClick={() => retry()}>
              Try again
            </button>
          </div>
        )}

        {!isLoading && entries && entries.length === 0 && (
          <p className="m-0 p-6 text-base-content/70">
            No checks yet. The deploy script books the first one; it shows here a few seconds after it runs.
          </p>
        )}

        {entries && entries.length > 0 && (
          <ol className="m-0 list-none divide-y divide-base-300 p-0">
            {entries.map(entry => (
              <Entry key={entry.timestamp} entry={entry} hashscan={hashscan} />
            ))}
          </ol>
        )}
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            className="btn btn-ghost rounded-full border border-base-300"
            onClick={() => loadMore()}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? (
              <span className="loading loading-spinner loading-sm" aria-label="Loading" />
            ) : (
              "Show older"
            )}
          </button>
        </div>
      )}
    </section>
  );
};
