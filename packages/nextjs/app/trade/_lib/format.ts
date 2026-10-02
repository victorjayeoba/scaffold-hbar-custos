import { formatUnits, parseUnits } from "viem";

/**
 * Display helpers for /trade. Values stay bigint until the last step; these only cut decimals for reading
 * (rounding toward zero, so a shown liquidation price or payout is never rounded in the trader's favour by more
 * than the last digit).
 */

const cut = (value: string, decimals: number) => {
  const [whole, frac = ""] = value.split(".");
  if (decimals === 0) return whole;
  return `${whole}.${frac.padEnd(decimals, "0").slice(0, decimals)}`;
};

const group = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, frac] = (negative ? value.slice(1) : value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
};

/** USD per HBAR, 1e18 → "0.10301" */
export const fmtPrice = (price?: bigint, decimals = 5) =>
  price === undefined ? "—" : group(cut(formatUnits(price, 18), decimals));

/** USDC, 1e6 → "1,234.56" */
export const fmtUsdc = (amount?: bigint, decimals = 2) =>
  amount === undefined ? "—" : group(cut(formatUnits(amount, 6), decimals));

/** USDC with an explicit sign: "+1.86" / "−0.83" */
export const fmtSignedUsdc = (amount?: bigint, decimals = 2) =>
  amount === undefined ? "—" : `${amount > 0n ? "+" : ""}${fmtUsdc(amount, decimals)}`;

/** HBAR size, 1e18 → "2,130.4" (absolute) */
export const fmtSize = (size?: bigint, decimals = 2) =>
  size === undefined ? "—" : group(cut(formatUnits(size < 0n ? -size : size, 18), decimals));

/** Tinybars or weibars → HBAR */
export const fmtHbar = (amount?: bigint, unitDecimals = 18, decimals = 4) =>
  amount === undefined ? "—" : group(cut(formatUnits(amount, unitDecimals), decimals));

/** Basis points → "1.23%" */
export const fmtBps = (bps?: bigint | number, decimals = 2) =>
  bps === undefined ? "—" : `${(Number(bps) / 100).toFixed(decimals)}%`;

/** A 1e18 = 100% rate → "0.0123%" */
export const fmtRate = (rate?: bigint, decimals = 4) =>
  rate === undefined ? "—" : `${(Number(rate) / 1e16).toFixed(decimals)}%`;

export const fmtDuration = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
};

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Parses a typed amount into base units, or explains why it can't. Accepts "1", "1.5", ".5"; rejects more decimals
 * than the token has, so nothing is silently rounded.
 */
export const parseAmount = (text: string, decimals: number): { value?: bigint; error?: string } => {
  const t = text.trim();
  if (t === "") return {};
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return { error: "Enter a number, like 10 or 2.5." };
  const frac = t.split(".")[1] ?? "";
  if (frac.length > decimals) return { error: `Use at most ${decimals} decimal places.` };
  return { value: parseUnits(t, decimals) };
};
