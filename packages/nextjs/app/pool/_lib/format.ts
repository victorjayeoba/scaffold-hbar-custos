import { formatUnits, parseUnits } from "viem";

export const USDC_DECIMALS = 6;

/** A token amount for people: grouped, trimmed, never in scientific notation. */
export const fmt = (value: bigint | undefined, decimals: number, maxFraction = 2, minFraction = 0) => {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, decimals));
  // Tiny non-zero amounts would round to 0.00; show them with more precision instead of lying.
  const fraction = n !== 0 && Math.abs(n) < 10 ** -maxFraction ? Math.min(decimals, 6) : maxFraction;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(minFraction, fraction),
    maximumFractionDigits: fraction,
  });
};

export const fmtUsdc = (value: bigint | undefined, maxFraction = 2) => fmt(value, USDC_DECIMALS, maxFraction, 2);

export const pct = (part: bigint | undefined, whole: bigint | undefined, digits = 1) => {
  if (part === undefined || whole === undefined || whole === 0n) return undefined;
  return (Number((part * 1_000_000n) / whole) / 10_000).toFixed(digits);
};

/** Parses what someone typed. undefined means "not a usable amount" (empty, malformed, too many decimals, zero). */
export const parseAmount = (text: string, decimals: number | undefined) => {
  if (decimals === undefined) return undefined;
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return undefined;
  const [, frac = ""] = t.split(".");
  if (frac.length > decimals) return undefined;
  try {
    const v = parseUnits(t, decimals);
    return v > 0n ? v : undefined;
  } catch {
    return undefined;
  }
};

/** Why an input can't be used, for the field's error line. */
export const amountProblem = (text: string, decimals: number | undefined) => {
  const t = text.trim();
  if (t === "" || decimals === undefined) return undefined;
  if (!/^\d*\.?\d*$/.test(t)) return "Enter a number, like 10 or 2.5.";
  const [, frac = ""] = t.split(".");
  if (frac.length > decimals) return `Use at most ${decimals} decimal places.`;
  if (parseAmount(t, decimals) === undefined) return "Enter an amount above zero.";
  return undefined;
};

export const HASHSCAN = "https://hashscan.io/testnet";

export const shortAddress = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
