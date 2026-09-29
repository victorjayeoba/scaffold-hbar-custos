"use client";

import { countdown, useNow } from "~~/hooks/custos/useNow";

type Props = {
  /** Seconds between network checks. */
  interval: number;
  /** Unix seconds of the check the network has already booked. Omit to preview the rhythm before deploy. */
  nextRunAt?: number;
};

const PAST_RUNS = 6;

const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/**
 * A time rail: checks the network already ran on the left, the one it has booked on the right, "now" in between.
 * It's the page's one moving part, because a booked future call is the whole point of Custos.
 */
export const ScheduleRail = ({ interval, nextRunAt }: Props) => {
  const now = useNow();
  // Keep the rail's height on the server render; it fills in once the browser knows the time.
  if (now === undefined) return <div className="h-36" />;
  const preview = nextRunAt === undefined;
  const next = nextRunAt ?? Math.ceil((now + 1) / interval) * interval;
  const start = next - PAST_RUNS * interval;
  const end = next + interval / 2;
  const at = (t: number) => `${((t - start) / (end - start)) * 100}%`;
  const past = Array.from({ length: PAST_RUNS }, (_, i) => start + i * interval);

  return (
    <figure className="m-0">
      <div className="relative mx-4 h-24" aria-hidden>
        <div className="absolute left-0 right-0 top-10 h-px bg-white/25" />
        {past.map(t => (
          <div key={t} className="absolute top-10 -translate-x-1/2 -translate-y-1/2" style={{ left: at(t) }}>
            <div className="h-2.5 w-2.5 rounded-full bg-[#5eead4]" />
            <div className="absolute top-4 left-1/2 -translate-x-1/2 text-xs text-white/50 tabular-nums">
              {clock(t)}
            </div>
          </div>
        ))}
        <div className="absolute top-4 bottom-8 w-px bg-white/60" style={{ left: at(now) }}>
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[11px] text-white/70">now</div>
        </div>
        <div className="absolute top-10 -translate-x-1/2 -translate-y-1/2" style={{ left: at(next) }}>
          <div className="relative h-4 w-4 rounded-full border-2 border-white bg-[#11151d]">
            <span className="absolute inset-[-6px] rounded-full border border-white/40 motion-safe:animate-ping" />
          </div>
          <div className="absolute top-5 left-1/2 -translate-x-1/2 text-xs text-white tabular-nums">{clock(next)}</div>
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-white/80">
        <span className="text-2xl tabular-nums text-white">{countdown(next - now)}</span>
        <span className="text-sm">
          until the network runs the next check.{" "}
          {preview
            ? "Showing the ten-minute rhythm; live times appear once the keeper is deployed."
            : `Booked on Hedera for ${clock(next)} UTC.`}
        </span>
      </figcaption>
    </figure>
  );
};
