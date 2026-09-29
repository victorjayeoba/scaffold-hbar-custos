# Custos — a margin engine the Hedera network keeps

> **Work in progress.** Built for the Scaffold-HBAR template bounty (submissions close 2026-10-04). Contracts, app and full docs land over the next few days.

Custos (Latin: *the keeper*) is a [Scaffold-HBAR](https://docs.hedera.com/solutions/tools/scaffold-hbar/index) template for margin trading on Hedera with no keeper bots. Liquidations and funding charges are run by the Hedera network itself through the Schedule Service (HIP-1215). Prices come from Chainlink and are cross-checked against Supra. The demo is an HBAR-USD perpetual futures market settled in USDC.

```bash
npm create scaffold-hbar@latest --template victorjayeoba/scaffold-hbar-custos
```

## What's in it

| Part | Job |
|---|---|
| `MarginAccount` | Collateral, health checks and liquidation rules |
| `ScheduledKeeper` | Reschedules itself on Hedera: checks capacity before booking, pays from a fee reserve, can be revived by anyone, sweeps accounts in pages |
| `PriceGuard` | Chainlink price, Supra cross-check, staleness and deviation limits, close-only mode |
| `PerpMarket` + `LiquidityPool` | The HBAR-USD demo market and the USDC pool that takes the other side |

## Status

- [x] Project set up from the official `payments-scheduler` template (Foundry + Next.js)
- [x] Chainlink and Supra feeds checked live on Hedera testnet
- [ ] Contracts and tests
- [ ] Testnet deployment with HashScan proof
- [ ] App: Trade, Pool, Keeper pages
- [ ] Full README, AGENTS.md, Harness recipe

## Licence

MIT. Built on [Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar) by hedera-dev and BuidlGuidl.
