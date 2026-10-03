# Hedera Harness recipe: add an ETH-USD market

This folder is a [Hedera Harness](https://github.com/hedera-dev/hedera-harness) recipe (`hedera-harness` 1.2.2, schema v2). It hands an AI coding agent one realistic task on this template, then checks the result in tiers, from file checks up to a live action on Hedera testnet.

**The task:** add an ETH-USD market by following the "Add a market" recipe in [`AGENTS.md`](../AGENTS.md). In Custos a market is configuration, not code: an entry in `packages/foundry/markets.json`, an ETH-specific test, and a row in the README's markets table. The contracts must not change. The full brief is [`prd.md`](prd.md).

## Files and tiers

| File | Tier | Checks |
|---|---|---|
| [`spec.yaml`](spec.yaml) | — | The recipe: baseline, validators, contract, chain tier |
| [`prd.md`](prd.md) | — | The task the agent gets |
| [`validators/static.json`](validators/static.json) | 0 | `markets.json` has ETH-USD with Chainlink ETH/USD and Supra pair 19, HBAR-USD is untouched, `test/markets/EthUsdMarket.t.sol` exists, the README lists `ETH-USD`, AGENTS.md documents `markets.json` and `check-market`, and no root or app `.env` file exists (`packages/foundry/.env` is allowed: the template's `postinstall` copies it from `.env.example`) |
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

**CI proves it both ways on every push to `main`.** [`.github/workflows/harness.yaml`](../.github/workflows/harness.yaml) runs on Ubuntu with no secrets: `yarn harness:validate` on `main` as shipped must fail, and fail for the missing ETH-USD market; then it applies `reference/eth-usd.patch` and `yarn harness:validate` must pass, Playwright tier included. (The chain tier and the agent tiers need an operator account and an agent, so they run only under `yarn harness:run`.)

**The recipe parses.** `hedera-harness doctor .harness/spec.yaml --recipe-only`:

```
✔ recipe — .harness/spec.yaml (schema v2)
Ready to run.
```

**A reference implementation passes.** Before handing the task to an agent, we solved the PRD by hand, on top of `main`, in three files. It is kept as a patch, [`reference/eth-usd.patch`](reference/eth-usd.patch), and not applied: the template ships without ETH-USD on purpose, so the recipe has something to do. `git apply .harness/reference/eth-usd.patch` adds:

- `packages/foundry/markets.json`: one new entry next to HBAR-USD:
  ```json
  "ETH-USD": {
    "chainlink": "0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9",
    "supra": "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917",
    "supraPair": 19,
    "maxStaleness": 86400,
    "maxDeviationBps": 500,
    "refPrice8": 270000000000
  }
  ```
- a new test, `packages/foundry/test/markets/EthUsdMarket.t.sol` (4 tests, ~135 lines), that reads that entry from `markets.json` and builds the stack on mocks at $2,700;
- one row in the README's markets table: `| ETH-USD | 0xb9d4…71b9 | 19 | 86400 s (testnet; ~3600 s on mainnet) | 500 bps |`.

With those three files:
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

**A recorded agent run: passed on the first attempt.** `hedera-harness run .harness/spec.yaml` on 2026-10-03, on a fresh clone of `main` with no ETH-USD, agent preset `claude` (Claude Opus), operator an ECDSA testnet account passed through environment variables only:

| | |
|---|---|
| Result | **PASSED, attempt 1 of 3, no findings** (`passed=true`, `openFindingIds=[]`) |
| Duration | 15 min 39 s (01:39:05 → 01:54:43 UTC), 17 min wall clock including setup |
| Stage 1/4 GENERATE | The agent read `AGENTS.md` and the PRD and changed 4 files, no contracts: the ETH-USD entry in `markets.json` (Chainlink `0xb9d4…71b9`, Supra pair 19, 86,400 s, 500 bps, `refPrice8` 270000000000), a new `test/markets/EthUsdMarket.t.sol` (5 tests, reading the entry from `markets.json`), a README row noting ~3,600 s on mainnet, and its own `GENERATION_NOTES.md` |
| Stage 2/4 ASSERT | Tier 0 static: 0 findings. Tier 1: `check-markets ETH-USD`, the ETH test, all contract tests, `foundry:lint`, type check, app lint and production build all exit 0 |
| Chain (Tier 3.5) | The harness created and funded throwaway account `0.0.10834938`, ran `yarn custos:check-market:testnet --market ETH-USD` (a PriceGuard deployed with the agent's config reading both live feeds), then swept the account back to 0 ℏ |
| Stage 3/4 SMOKE | Playwright gate: `/`, `/keeper`, `/trade`, `/pool`, `/debug` |
| Stage 4/4 EVALUATE | The adversarial validator, verbatim: *"All four assertions positively verified on the running app at http://localhost:3001. Keeper, trade, pool and debug pages all render with the expected labels, controls and live data; new ETH-USD market was added as configuration only and did not disturb the existing HBAR-USD surfaces."* |

What the agent wrote (the harness committed it to a throwaway run branch, which isn't kept in this repo: the recipe's job is to produce it, so `main` stays without ETH-USD):

| File | Agent's change |
|---|---|
| `packages/foundry/markets.json` | `+8` lines: the ETH-USD entry, with the same values as the reference above |
| `packages/foundry/test/markets/EthUsdMarket.t.sol` | new, `+162` lines, 5 tests: guard reads Ok and scales $2,700 to 1e18; 1,000 USDC notional sized in ETH units; liquidation price ~9% below entry; the network liquidates it via `vm.prank(address(market)); market.tick()`; a short closes at a profit paid by the pool |
| `README.md` | `+1` line: `\| ETH-USD \| 0xb9d4…71b9 \| 19 \| 86400 s (testnet; use ~3600 s on mainnet) \| 500 bps \|` |
| `GENERATION_NOTES.md` | new, `+15` lines: what it changed, and the checks it ran (`check-markets ETH-USD`, the ETH test 5/5, `Markets.t.sol` 2/2) |

Raw run artifacts went to `.harness/runs/`, which is gitignored.

The first try at this run found a bug in the recipe, not in the template. The chain command was written as `DEPLOYER_PRIVATE_KEY="$HARNESS_SIGNER_PRIVATE_KEY" yarn …`, a POSIX-only prefix that cmd.exe rejects (`'DEPLOYER_PRIVATE_KEY' is not recognized`). It now uses the harness's own `expose.envVars: [DEPLOYER_PRIVATE_KEY]` and a plain `yarn` command that works in every shell. (On that try the agent had already implemented the PRD correctly; only the chain step failed.)

**Windows notes for `run`.** Beyond the dev-server flag above, two more 1.2.2 spawns assume a POSIX host. The Tier 3 browser preflight runs `spawn("npx", …)` without a shell (on Windows `npx` is `npx.cmd`), and its best-effort cleanup then throws `EBUSY` on the probe's temp folder and ends the run. The recorded run used local one-line patches for both (`shell: process.platform === "win32"` on that spawn; `.catch(() => undefined)` on the cleanup), and put Claude Code's native `claude.exe` folder first on `PATH` so the harness's `spawn("claude")` finds it. None of this touches the recipe or the template; on macOS, Linux or CI none of it is needed.
