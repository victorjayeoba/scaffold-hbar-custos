// Checks markets.json offline: every market has what PriceGuard needs, within the limits PriceGuard enforces.
//
//   node scripts-js/checkMarkets.js              check every market
//   node scripts-js/checkMarkets.js ETH-USD      ...and fail unless ETH-USD is one of them
//
// No network, no keys. `yarn workspace @sh/foundry custos check-market --market <NAME>` is the on-chain check.
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_STALENESS_LIMIT = 86400; // PriceGuard.MAX_STALENESS_LIMIT
const MAX_DEVIATION_LIMIT_BPS = 2000; // PriceGuard.MAX_DEVIATION_LIMIT_BPS
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const markets = JSON.parse(readFileSync(join(ROOT, "markets.json"), "utf8"));
const required = process.argv.slice(2);
const problems = [];

for (const name of required) {
  if (!markets[name]) problems.push(`${name}: missing from markets.json`);
}

for (const [name, m] of Object.entries(markets)) {
  const bad = (msg) => problems.push(`${name}: ${msg}`);
  if (!/^[A-Z0-9]+-USD$/.test(name)) bad(`name must look like ASSET-USD`);
  for (const key of ["chainlink", "supra"]) {
    if (!ADDRESS.test(m[key] ?? "")) bad(`${key} must be a 0x address`);
  }
  for (const key of [
    "supraPair",
    "maxStaleness",
    "maxDeviationBps",
    "refPrice8",
  ]) {
    if (!Number.isInteger(m[key]) || m[key] < 0)
      bad(`${key} must be a non-negative integer`);
  }
  if (m.maxStaleness === 0 || m.maxStaleness > MAX_STALENESS_LIMIT) {
    bad(
      `maxStaleness must be 1..${MAX_STALENESS_LIMIT} s (PriceGuard rejects anything else)`
    );
  }
  if (m.maxDeviationBps === 0 || m.maxDeviationBps > MAX_DEVIATION_LIMIT_BPS) {
    bad(`maxDeviationBps must be 1..${MAX_DEVIATION_LIMIT_BPS}`);
  }
  if (m.refPrice8 === 0)
    bad("refPrice8 (a typical price, 8 decimals) must be above 0");
}

const chainlinks = Object.values(markets).map((m) =>
  m.chainlink?.toLowerCase()
);
if (new Set(chainlinks).size !== chainlinks.length) {
  problems.push(
    "two markets share a Chainlink feed: each market needs its own"
  );
}

if (problems.length > 0) {
  console.error(`❌ markets.json:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`✅ markets.json: ${Object.keys(markets).join(", ")}`);
