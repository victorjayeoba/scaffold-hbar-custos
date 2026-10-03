"use client";

import { ExternalLink } from "./KeeperHeartbeat";
import { shortAddress, utcDay, utcTime } from "./format";
import { type AuditMessage, HCS_TOPIC, useHcsAuditLog } from "~~/hooks/custos/useHcsAuditLog";
import { useHederaLinks } from "~~/hooks/custos/useKeeperActivity";

const describe = (m: AuditMessage): React.ReactNode => {
  switch (m.e) {
    case "Liquidated":
      return (
        <>
          Liquidated {m.trader ? <span className="font-mono">{shortAddress(m.trader)}</span> : "a position"} at $
          {String(m.price)}
          {m.byNetwork ? ", by the network, no reward" : `, by ${m.by ? shortAddress(String(m.by)) : "a liquidator"}`}
        </>
      );
    case "SweepSkipped":
      return <>Skipped the sweep: the price was {String(m.status)}, so nobody was liquidated</>;
    case "Swept":
      return (
        <>
          Swept positions {String(m.from)}–{String(m.to)}, {String(m.liq)} liquidated
        </>
      );
    case "Ticked":
      return m.ok === false ? <>Check ran, its work reverted, next one still booked</> : <>Check ran</>;
    case "Refueled":
      return <>Refuelled the fee reserve through SaucerSwap</>;
    default:
      return <>{String(m.e)}</>;
  }
};

/** The keeper's events as copied to the Hedera Consensus Service: an audit trail outside the contract's own logs. */
export const KeeperAuditLog = () => {
  const { hashscan } = useHederaLinks();
  const { data, isLoading, error } = useHcsAuditLog();

  return (
    <section aria-labelledby="audit-title" className="mx-auto w-full max-w-6xl px-5 pb-16">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="audit-title" className="m-0 text-3xl font-normal tracking-[-0.01em]">
          Audit log on HCS
        </h2>
        <ExternalLink href={`${hashscan}/topic/${HCS_TOPIC}`} label={`Topic ${HCS_TOPIC} on HashScan`}>
          Topic {HCS_TOPIC}
        </ExternalLink>
      </div>
      <p className="mt-3 max-w-3xl text-base-content/70">
        Every keeper event is also written to a Hedera Consensus Service topic, ordered and timestamped by the network.
        The keeper never depends on it: anyone can rebuild it from the mirror node with{" "}
        <code>yarn custos:hcs-log:testnet</code>, which only adds events the topic doesn&apos;t have yet.
      </p>

      <div className="mt-6 overflow-hidden rounded-box border border-base-300 bg-base-100">
        {isLoading && <p className="m-0 p-5 text-base-content/60">Reading the topic from the mirror node…</p>}
        {error && <p className="m-0 p-5 text-error">Couldn&apos;t read the topic: {(error as Error).message}</p>}
        {data && data.length === 0 && <p className="m-0 p-5 text-base-content/60">No messages in the topic yet.</p>}
        {data && data.length > 0 && (
          <ol className="m-0 list-none divide-y divide-base-300 p-0">
            {data.map(({ sequence, message }) => {
              const network = message?.e === "Liquidated" && message.byNetwork;
              const at = message ? Number(message.ts.split(".")[0]) : undefined;
              return (
                <li
                  key={sequence}
                  className={`grid gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[4rem_7rem_minmax(0,1fr)_auto] sm:items-baseline ${
                    network ? "bg-[#5eead4]/10" : ""
                  }`}
                >
                  <span className="font-mono text-sm text-base-content/60">#{sequence}</span>
                  <span className="text-sm text-base-content/70 tabular-nums">
                    {at ? (
                      <>
                        {utcTime(at)} <span className="text-base-content/50">{utcDay(at)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span>
                    {message ? (
                      <>
                        {message.run !== undefined && (
                          <span className="text-base-content/60">Run {message.run} · </span>
                        )}
                        {describe(message)}
                      </>
                    ) : (
                      <span className="text-base-content/60">A message this page can&apos;t read</span>
                    )}
                  </span>
                  {message?.tx && (
                    <ExternalLink
                      href={`${hashscan}/transaction/${message.tx}`}
                      label={`Transaction of message ${sequence}`}
                    >
                      tx
                    </ExternalLink>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
};
