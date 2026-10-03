import { NextResponse } from "next/server";
import { HBAR_PRICE_CACHE_DURATION_MS } from "~~/utils/scaffold-hbar/hbarPrice";

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd";
const REVALIDATE_SECONDS = HBAR_PRICE_CACHE_DURATION_MS / 1000;

/**
 * HBAR/USD for the footer price pill. CoinGecko sends no CORS headers on errors (a rate limit, say), so a
 * browser fetch fails with console errors; this route fetches it server-side and shares one cached answer.
 * Answers 200 with `price: null` when CoinGecko is unavailable, so the page hides the pill instead of logging.
 */
export async function GET() {
  let price: number | null = null;
  try {
    const res = await fetch(COINGECKO_URL, { next: { revalidate: REVALIDATE_SECONDS } });
    if (res.ok) {
      const usd = ((await res.json()) as { "hedera-hashgraph"?: { usd?: unknown } })["hedera-hashgraph"]?.usd;
      if (typeof usd === "number" && usd > 0) price = usd;
    }
  } catch (e) {
    console.warn("[api/hbar-price]", e);
  }
  return NextResponse.json(
    { price },
    { headers: { "Cache-Control": `public, max-age=${price === null ? 0 : REVALIDATE_SECONDS}` } },
  );
}
