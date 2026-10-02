"use client";

import { span, spanInWords, utcDay, utcTime } from "./format";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { ScheduleRail } from "~~/components/custos/ScheduleRail";
import { hederaIdOf, useHederaLinks, useKeeperActivity } from "~~/hooks/custos/useKeeperActivity";
import { type KeeperState, useKeeperHealth } from "~~/hooks/custos/useKeeperHealth";
import { ago } from "~~/hooks/custos/useNow";

const DOT: Record<KeeperState | "unpaid", string> = {
  loading: "bg-white/40",
  scheduled: "bg-[#5eead4]",
  due: "bg-[#5eead4]",
  unpaid: "bg-warning",
  late: "bg-warning",
  overdue: "bg-error",
  stopped: "bg-error",
};

export const ExternalLink = ({
  href,
  children,
  label,
}: {
  href: string;
  children: React.ReactNode;
  label?: string;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    aria-label={label}
    className="link inline-flex items-center gap-1 font-mono text-sm"
  >
    {children}
    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
  </a>
);

/** The live heartbeat: is the network still running this market, and when does it run next? */
export const KeeperHeartbeat = () => {
  const k = useKeeperHealth();
  const { hashscan } = useHederaLinks();
  const { contractId, entries } = useKeeperActivity();

  const unpaid = k.state === "scheduled" && k.canPayNextRun === false;
  const tone = unpaid ? "unpaid" : k.state;
  const next = k.nextRunAt ?? 0;
  const nextRun = (k.runCount ?? 0) + 1;
  const scheduleId = k.nextSchedule ? hederaIdOf(k.nextSchedule) : undefined;
  const lastTick = entries?.find(e =>
    e.events.some(ev => ev.eventName === "Ticked" && Number(ev.args.run) === k.runCount),
  );

  const headline = {
    loading: "Reading the keeper on Hedera…",
    scheduled: unpaid ? "Booked, but the reserve can't pay for it" : "The network is keeping this market",
    due: `Check ${nextRun} is due. Hedera runs it within seconds.`,
    late: "The booked check hasn't run",
    overdue: "The chain of checks is broken",
    stopped: "The keeper is stopped",
  }[k.state];

  const detail = {
    loading: "",
    scheduled: unpaid
      ? "Hedera will try the booked check, but the fee reserve can't cover it, so it will fail. Top it up below."
      : "No bot and no server. Each check was booked by the one before it, and the contract pays for it.",
    due: "Hedera executes the booked call itself. This page re-reads the contract every 30 seconds.",
    late: `Checks usually run within a second of their booking. Anyone can revive the chain from ${
      k.reviveOpensAt ? `${utcTime(k.reviveOpensAt)} UTC` : "two intervals after the booking"
    }.`,
    overdue: "The booked check failed or never ran, so nothing is booked after it. Anyone can call revive().",
    stopped: "Nothing is booked. Anyone can start the chain again with revive().",
  }[k.state];

  // Screen readers hear the countdown at minute precision, not every second.
  const announce =
    k.state === "scheduled" && k.now !== undefined
      ? `${headline}. Next check in ${spanInWords(next - k.now)}.`
      : headline;

  const [countdownLabel, countdownValue] =
    k.now === undefined || k.state === "loading"
      ? ["Next check in", "--:--"]
      : k.state === "scheduled"
        ? ["Next check in", span(next - k.now)]
        : k.state === "due"
          ? ["Next check", "Due now"]
          : k.state === "stopped"
            ? ["Next check", "None booked"]
            : ["Overdue by", span(k.now - next)];

  return (
    <section className="bg-black text-white" aria-labelledby="keeper-title">
      <div className="mx-auto max-w-7xl px-5 pt-12 pb-14 sm:pt-16">
        <p className="m-0 text-sm uppercase tracking-[0.18em] text-white/60">Keeper · Hedera Schedule Service</p>
        <h1
          id="keeper-title"
          className="mt-4 text-[clamp(2.4rem,6vw,4.5rem)] font-normal leading-[1.05] tracking-[-0.02em]"
        >
          Pull the plug. Hedera keeps the books.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/80">
          Every {k.interval ? k.interval / 60 : 30} minutes Hedera calls this market by itself, from a schedule the
          previous run booked (HIP-1215). It charges funding, sweeps for underwater positions and books the next run. No
          one signs these transactions.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-end">
          <div>
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
                {(tone === "scheduled" || tone === "due") && (
                  <span className={`absolute inset-0 rounded-full ${DOT[tone]} opacity-60 motion-safe:animate-ping`} />
                )}
                <span className={`relative h-3 w-3 rounded-full ${DOT[tone]}`} />
              </span>
              <h2 className="m-0 text-xl font-normal leading-snug">{headline}</h2>
            </div>
            {detail && <p className="mt-2 mb-0 max-w-xl text-white/70">{detail}</p>}
            <div className="mt-8">
              <div className="text-sm text-white/60">{countdownLabel}</div>
              <div
                className={`text-[clamp(3rem,9vw,5.5rem)] leading-none tabular-nums ${
                  k.state === "overdue" || k.state === "late" ? "text-error" : "text-white"
                }`}
              >
                {countdownValue}
              </div>
            </div>
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {announce}
            </p>
          </div>

          <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-box bg-white/15 sm:grid-cols-3">
            <Stat label={k.state === "scheduled" || k.state === "due" ? "Booked for" : "Was booked for"}>
              {next > 0 ? (
                <>
                  {utcTime(next)} UTC
                  <Sub>{utcDay(next)}</Sub>
                </>
              ) : (
                "—"
              )}
            </Stat>
            <Stat label="Checks run">
              {k.runCount ?? "…"}
              <Sub>every {k.interval ? `${k.interval / 60} min` : "…"}</Sub>
            </Stat>
            <Stat label="Last check">
              {k.lastRunAt ? `${utcTime(k.lastRunAt)} UTC` : k.runCount === 0 ? "None yet" : "…"}
              <Sub>
                {k.lastRunAt && k.now !== undefined ? `${ago(Math.max(0, k.now - k.lastRunAt))} · ` : ""}
                {lastTick && (
                  <ExternalLink href={`${hashscan}/transaction/${lastTick.timestamp}`} label="Last check on HashScan">
                    tx
                  </ExternalLink>
                )}
              </Sub>
            </Stat>
            <Stat label="Booked schedule">
              {scheduleId ? (
                <ExternalLink href={`${hashscan}/schedule/${scheduleId}`} label={`Schedule ${scheduleId} on HashScan`}>
                  {scheduleId}
                </ExternalLink>
              ) : k.loaded ? (
                "None"
              ) : (
                "…"
              )}
              <Sub>{k.state === "overdue" ? "did not complete" : "Schedule Service"}</Sub>
            </Stat>
            <Stat label="Market contract">
              {contractId ? (
                <ExternalLink href={`${hashscan}/contract/${contractId}`} label={`Contract ${contractId} on HashScan`}>
                  {contractId}
                </ExternalLink>
              ) : (
                "…"
              )}
              <Sub>PerpMarket</Sub>
            </Stat>
            <Stat label="Can pay next run">
              {k.canPayNextRun === undefined ? "…" : k.canPayNextRun ? "Yes" : "No"}
              <Sub>{k.runsLeft === undefined ? "" : `${k.runsLeft} run${k.runsLeft === 1 ? "" : "s"} in reserve`}</Sub>
            </Stat>
          </dl>
        </div>

        {(k.state === "scheduled" || k.state === "due") && (
          <div className="mt-12 max-w-4xl">
            <ScheduleRail />
          </div>
        )}
      </div>
    </section>
  );
};

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0 bg-black p-4 sm:p-5">
    <dt className="text-xs uppercase tracking-wider text-white/55">{label}</dt>
    <dd className="m-0 mt-2 break-words text-lg tabular-nums">{children}</dd>
  </div>
);

const Sub = ({ children }: { children: React.ReactNode }) => (
  <span className="mt-1 block text-sm text-white/55">{children}</span>
);
