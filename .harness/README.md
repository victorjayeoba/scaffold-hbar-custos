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
yarn harness:doctor --recipe-only

# tiers 0–2 against the current workspace, no agent
yarn harness:validate

# the full loop: the agent implements the PRD, every tier runs, failures go back to the agent (up to 3 attempts)
export HEDERA_OPERATOR_ID=0.0.xxxx HEDERA_OPERATOR_KEY=0x...   # an ECDSA testnet account with ~15 ℏ; shell only, never a file
yarn harness:run
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

**Validators fail without the feature and pass with it.** `hedera-harness validate .harness/spec.yaml` on 2026-10-03, on two fresh clones (submodules included, `yarn install` from scratch):

| Workspace | Result |
|---|---|
| `main` as shipped (no ETH-USD) | `passed=false`, **8 findings, every one about the missing feature**, no false alarms: the ETH test file is missing (twice: required file, text assertion), `markets.json` lacks `"ETH-USD"`, the Chainlink ETH/USD address and `"supraPair": 19`, the README lacks `\| ETH-USD \|`, and the `markets-config` and `eth-usd-test` commands fail. Tier 2 is skipped because Tier 1 failed |
| `main` + the reference implementation (3 files: `markets.json`, the ETH test, the README row) | **`passed=true`, `findings=0`, `playwrightGate=true routes=5`** |

The passing run, command by command:

```
command yarn install exit=0
command yarn workspace @sh/foundry check-markets ETH-USD exit=0
command node -e "require('fs').statSync('packages/foundry/test/markets/EthUsdMarket.t.sol')" && yarn workspace @sh/foundry test --match-path test/markets/EthUsdMarket.t.sol exit=0
command yarn foundry:test exit=0
command yarn foundry:lint exit=0
command yarn next:check-types exit=0
command yarn next:lint --max-warnings=0 exit=0
command yarn next:build exit=0
Playwright gate: / /keeper /trade /pool /debug → 200, rendered, 0 console errors, no forbidden text
Validation finished  passed=true  findings=0  playwrightGate=true routes=5
```

Two validator mistakes surfaced in the first "without" run and were fixed before these results: `packages/foundry/.env` was forbidden, but the template's own `postinstall` creates it from `.env.example` (no secrets), so it read as a false alarm; and `forge test --match-path` exits 0 when no test matches, so the `eth-usd-test` command now checks the file exists first.

**Running the harness: prerequisites we hit.**
- `hedera-harness` and `playwright` must both be **root** devDependencies (they are, in `package.json`). Under `npx hedera-harness`, the tool can't import `playwright` from npm's cache, and the Tier 2 gate fails before any route with no visible reason.
- **Windows:** `hedera-harness` 1.2.2 starts the dev server with `spawn(..., { detached: true })`. On Windows that gives the child its own console, so the gate never sees `Local: http://…`, times out after 30 s, and leaves the dev server running. Run the harness on macOS, Linux or CI. The passing run above was made on Windows with that one flag set to `process.platform !== "win32"` in the installed `dist/validation/devServer.js`; nothing in the recipe changed.

**A recorded agent run.** _Recorded here after `hedera-harness run`._
