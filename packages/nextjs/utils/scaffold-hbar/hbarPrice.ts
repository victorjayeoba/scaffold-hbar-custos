export const HBAR_PRICE_CACHE_DURATION_MS = 60 * 1000;
/** Our own route: it fetches CoinGecko server-side, since CoinGecko's errors carry no CORS headers. */
export const HBAR_PRICE_URL = "/api/hbar-price";

type HbarPriceCache = {
  price: number;
  timestamp: number;
};

let cache: HbarPriceCache | null = null;

/** HBAR in USD, or 0 when no price is available (the footer then hides it). */
export async function fetchHbarPrice(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.timestamp < HBAR_PRICE_CACHE_DURATION_MS) {
    return cache.price;
  }

  try {
    const response = await fetch(HBAR_PRICE_URL);
    const data = (await response.json()) as { price?: number | null };
    const price = data.price ?? 0;
    cache = { price, timestamp: now };
    return price;
  } catch (error) {
    // The app's own route is unreachable (server stopped, offline): keep the last price, don't fail the page.
    console.warn("Failed to fetch HBAR price:", error);
    return cache?.price ?? 0;
  }
}
