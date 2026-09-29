"use client";

import { useKeeper } from "~~/hooks/custos/useKeeper";
import { countdown, useNow } from "~~/hooks/custos/useNow";

const MAX_DOTS = 6;
// Matches the deployed keeper; only used until the contract read arrives.
const FALLBACK_INTERVAL = 1800;

const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/**
 * A time rail: checks the network already ran on the left, the one it has booked on the right, "now" in between.
 * Reads the live keeper on Hedera testnet. Until that read arrives it shows the rhythm in grey, so a dot is only
 * ever teal when the network really ran that check.
 */
export const ScheduleRail = () => {
  const now = useNow();
  const keeper = useKeeper();
  // Keep the rail's height on the server render; it fills in once the browser knows the time.
  if (now === undefined) return <div className="h-36" />;

  const live = keeper.loaded && keeper.nextRunAt! > 0;
  const interval = keeper.interval ?? FALLBACK_INTERVAL;
  const next = live ? keeper.nextRunAt! : Math.ceil((now + 1) / interval) * interval;
  const ran = live ? Math.min(keeper.runCount!, MAX_DOTS) : MAX_DOTS;
  // The last run is exact; earlier ones are spaced one interval apart (the keeper books each from the one before).
  const lastRun = live && keeper.lastRunAt ? keeper.lastRunAt : next - interval;
  const past = Array.from({ length: ran }, (_, i) => lastRun - (ran - 1 - i) * interval);
  const start = Math.min(next - MAX_DOTS * interval, ...past);
  const end = next + interval / 2;
  const at = (t: number) => `${((t - start) / (end - start)) * 100}%`;
  const due = next - now;

  return (
    <figure className="m-0">
      <div className="relative mx-4 h-24" aria-hidden>
        <div className="absolute left-0 right-0 top-10 h-px bg-white/25" />
        {past.map(t => (
          <div key={t} className="absolute top-10 -translate-x-1/2 -translate-y-1/2" style={{ left: at(t) }}>
            <div
              className={`h-2.5 w-2.5 rounded-full ${live ? "bg-[#5eead4]" : "border border-white/40 bg-transparent"}`}
            />
            <div className="absolute top-4 left-1/2 -translate-x-1/2 text-xs text-white/50 tabular-nums">
              {clock(t)}
            </div>
          </div>
        ))}
        <div className="absolute top-4 bottom-8 w-px bg-white/60" style={{ left: at(Math.min(now, next)) }}>
          {/* The label would sit on the booked marker in the last stretch before a run. */}
          {due > interval / 4 && (
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[11px] text-white/70">now</div>
          )}
        </div>
        <div className="absolute top-10 -translate-x-1/2 -translate-y-1/2" style={{ left: at(next) }}>
          <div className="relative h-4 w-4 rounded-full border-2 border-white bg-[#11151d]">
            <span className="absolute inset-[-6px] rounded-full border border-white/40 motion-safe:animate-ping" />
          </div>
          <div className="absolute top-5 left-1/2 -translate-x-1/2 text-xs text-white tabular-nums">{clock(next)}</div>
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-white/80">
        <span className="text-2xl tabular-nums text-white">{countdown(due)}</span>
        <span className="text-sm">
          {!live && "Reading the keeper on Hedera testnet…"}
          {live &&
            due > 0 &&
            `until the network runs check ${keeper.runCount! + 1}. Booked on Hedera for ${clock(next)} UTC.`}
          {live && due <= 0 && "The booked check is due. Hedera runs it in the next few seconds."}
        </span>
      </figcaption>
    </figure>
  );
};
