import { formatUnits } from "viem";

/** "14:05:12" in UTC. */
export const utcTime = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false });

/** "30 Sep" in UTC. */
export const utcDay = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

/** Tinybars as HBAR, e.g. "1.65". */
export const hbar = (tinybars: bigint, digits = 2) =>
  Number(formatUnits(tinybars, 8)).toLocaleString("en-US", { maximumFractionDigits: digits });

/** A span of time, e.g. "12:04", "1:02:04" or "2 d 14 h". */
export const span = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s % 60)}`;
  return `${pad(m)}:${pad(s % 60)}`;
};

/** A span in words for screen readers, at minute precision: "about 12 minutes". */
export const spanInWords = (seconds: number) => {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 48) return `about ${h} hour${h === 1 ? "" : "s"}`;
  return `about ${Math.round(h / 24)} days`;
};

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
