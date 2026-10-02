# Hedera Harness recipe: add an ETH-USD market

This folder is a [Hedera Harness](https://github.com/hedera-dev/hedera-harness) recipe (`hedera-harness` 1.2.2, schema v2). It hands an AI coding agent one realistic task on this template, then checks the result in tiers, from file checks up to a live action on Hedera testnet.

**The task:** add an ETH-USD market by following the "Add a market" recipe in [`AGENTS.md`](../AGENTS.md). In Custos a market is configuration, not code: an entry in `packages/foundry/markets.json`, an ETH-specific test, and a row in the README's markets table. The contracts must not change. The full brief is [`prd.md`](prd.md).

## Files and tiers

| File | Tier | Checks |
|---|---|---|
| [`spec.yaml`](spec.yaml) | — | The recipe: baseline, validators, contract, chain tier |
| [`prd.md`](prd.md) | — | The task the agent gets |
| [`validators/static.json`](validators/static.json) | 0 | `markets.json` has ETH-USD with Chainlink ETH/USD and Supra pair 19, HBAR-USD is untouched, `test/markets/EthUsdMarket.t.sol` exists, the README lists `ETH-USD`, AGENTS.md documents `markets.json` and `check-market`, and no `.env` file exists anywhere |
| [`validators/yarn.json`](validators/yarn.json) | 1 | `check-markets ETH-USD` (offline config check), the ETH test, all 213+ contract tests and invariants, `foundry:lint`, the app's type check, lint and production build. No keys, no network |
| [`validators/playwright-smoke.yaml`](validators/playwright-smoke.yaml) | 2 | `/`, `/keeper`, `/trade`, `/pool` and `/debug` load with no error overlay |
| [`acceptance-contract.json`](acceptance-contract.json) | 3 | An adversarial agent grades the running app with no wallet: the keeper, trade and pool pages still read the live HBAR-USD deployment (adding a market must not break anything) |
| `spec.yaml` → `chainValidation` | 3.5 | Deploys a PriceGuard with the new ETH-USD config from the harness's throwaway testnet account and reads both live feeds; fails if either doesn't answer |

## Run it

```bash
# check the recipe itself
npx hedera-harness@1.2.2 doctor .harness/spec.yaml --recipe-only

# tiers 0–2 against the current workspace, no agent
npx hedera-harness@1.2.2 validate .harness/spec.yaml

# the full loop: the agent implements the PRD, every tier runs, failures go back to the agent (up to 3 attempts)
export HEDERA_OPERATOR_ID=0.0.xxxx HEDERA_OPERATOR_KEY=0x...   # an ECDSA testnet account with ~15 ℏ; shell only, never a file
npx hedera-harness@1.2.2 run .harness/spec.yaml
```

The chain tier needs Foundry (`forge`, `cast`) on the PATH. The harness creates one EVM-aliased account per run, funds it with 10 ℏ from your operator, passes it to the deploy command as `DEPLOYER_PRIVATE_KEY` (environment only), and sweeps what's left back afterwards. A PriceGuard deploy costs about 1 ℏ. Run artifacts go to `.harness/runs/`, which is gitignored.

## How the recipe was verified

**The recipe parses.** `hedera-harness doctor .harness/spec.yaml --recipe-only`:

```
✔ recipe — .harness/spec.yaml (schema v2)
Ready to run.
```

**A reference implementation passes.** The branch [`harness/eth-usd-reference`](../../../tree/harness/eth-usd-reference) is a hand-written solution to the PRD: the ETH-USD entry in `markets.json` and `test/markets/EthUsdMarket.t.sol`. On it:
- `check-markets ETH-USD` → `✅ markets.json: HBAR-USD, ETH-USD`
- `forge test --match-path "test/markets/*"`: 4 passed. ETH sizing (1,000 USDC notional at $2,700 = 0.37 ETH), a 10x long's liquidation price ~9% below entry and the network liquidating it on the next tick, and a short closing at a profit.
- `test/Markets.t.sol` (which cycles every market in `markets.json`) passes with both markets.

**The chain step works on testnet.** `yarn custos:check-market:testnet --market ETH-USD` on 2026-10-03 deployed PriceGuard [`0x1eD9de819a144d7b6C80102Ff5FA83180151949D`](https://hashscan.io/testnet/contract/0x1eD9de819a144d7b6C80102Ff5FA83180151949D) and read:

```
ETH-USD: Chainlink 2657.85, Supra 2702.77, status Stale
✅ Both feeds answer
```

`Stale` was the honest reading that day: Supra's testnet ETH/USDT hadn't updated for 8 hours (its HBAR pair updates every few minutes). That is why the PRD asks for the 1-day staleness window on testnet.

**Validators fail without the feature and pass with it.** _Run against `main` once the README and AGENTS.md land; results are recorded here._

**A recorded agent run.** _Recorded here after `hedera-harness run`._
