# PRD: add an ETH-USD market

## Goal

Custos ships one market, HBAR-USD. Add a second, **ETH-USD**, the way `AGENTS.md` ("Add a market") says to: as configuration, with no change to the contracts.

## Why it matters

A template is only reusable if a developer can point it at another asset without touching risk-critical Solidity. The engine (`PriceGuard`, `MarginAccount`, `ScheduledKeeper`, `PerpMarket`, `LiquidityPool`) is asset-agnostic; a market is a price-guard config plus a deployment. This recipe proves that claim end to end, including live feeds on Hedera testnet.

## Requirements

1. **Config.** Add `"ETH-USD"` to `packages/foundry/markets.json`, next to `"HBAR-USD"` (which must stay exactly as it is):
   - `chainlink`: Chainlink ETH/USD on Hedera testnet, `0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9` (8 decimals).
   - `supra`: the same Supra push-oracle contract HBAR-USD uses, `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917`.
   - `supraPair`: `19` (Supra's ETH/USDT). Pair 1 is stale on testnet; don't use it.
   - `maxStaleness`: `86400` (1 day, the most `PriceGuard` allows). Supra's testnet ETH/USDT pushes rarely (it has been seen 8 h old) while its HBAR pair updates every few minutes, so anything shorter reads as Stale on testnet. Note in the README row that mainnet should use about `3600`.
   - `maxDeviationBps`: `500`.
   - `refPrice8`: a typical ETH price with 8 decimals, e.g. `270000000000` ($2,700).
2. **Test.** Add `packages/foundry/test/markets/EthUsdMarket.t.sol`. It must read the ETH-USD entry from `markets.json` (not hard-code it) and check, on mocks at the reference price:
   - the guard built from the entry reads `Ok` and scales an 8-decimal $2,700 to 1e18;
   - a 1,000 USDC-notional position is sized in ETH units (`1000e6 * 1e30 / price`);
   - a 10x long's liquidation price is about 9% below entry, and the network liquidates it on the next tick once the price is there;
   - a short closes at a profit after ETH falls, paid by the pool.
   `test/Markets.t.sol` already cycles every market generically; this test pins the ETH-specific numbers.
3. **Docs.** Add an `ETH-USD` row to the markets table in `README.md` (feed address, Supra pair, staleness), in the same format as the HBAR-USD row.
4. **Checks.** `yarn workspace @sh/foundry check-markets ETH-USD` passes (offline). `yarn custos:check-market:testnet --market ETH-USD` passes on testnet (both feeds answer).

## Out of scope

- No contract changes. If you think one is needed, stop: that means the recipe is wrong.
- The app keeps showing HBAR-USD; don't add a market switcher.
- Don't deploy a full ETH-USD market (pool, keeper reserve); the testnet check deploys only a `PriceGuard`.
- Never write keys into any file. The testnet check reads `DEPLOYER_PRIVATE_KEY` from the environment.
