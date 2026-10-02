# Agent instructions

Briefing for coding agents in this repo (Claude Code, Cursor, Codex). Claude Code loads it through `CLAUDE.md`.

This is **Custos**, a Scaffold-HBAR template (Foundry + Next.js App Router): a margin engine whose liquidations and funding are run by the Hedera Schedule Service (HIP-1215), with no keeper bot. Three reusable contracts (`ScheduledKeeper`, `PriceGuard`, `MarginAccount`) and a demo HBAR-USD perpetual market (`PerpMarket`) backed by a USDC pool (`LiquidityPool`) whose shares are a native HTS token. The app has `/`, `/trade`, `/pool`, `/keeper`, `/debug` and `/blockexplorer`.

The design notes, measurements and the reason behind each rule below are in [packages/foundry/CONTRACTS_NOTES.md](packages/foundry/CONTRACTS_NOTES.md). Proof transactions are in [packages/foundry/TESTNET.md](packages/foundry/TESTNET.md). The contract source is the source of truth.

Use the package manager this project was created with (`packageManager` in the root `package.json`). Examples below use `yarn <script>`; with npm, run `npm run <script>` and put `--` before flags.

**The Schedule Service exists only on Hedera testnet and mainnet**, not on Anvil or a Foundry fork. Tests use mocks; real ticks need a testnet deploy.

## Repo map

| Path | What it is |
| --- | --- |
| `packages/foundry/contracts/ScheduledKeeper.sol` | Abstract keeper: `tick()`, `revive()`, `fund()`, `runWork()`, `_work()`, `_keepGoing()`, capacity probing, gas hold |
| `packages/foundry/contracts/PriceGuard.sol` | Chainlink price + Supra cross-check: `read()`, `price()`, `prices()`, `status()`, `setParams()` |
| `packages/foundry/contracts/MarginAccount.sol` | Abstract position book: `pnl`, `fundingOwed`, `equity`, `maintenanceMargin`, `isLiquidatable`, `liquidationPrice`, `netTraderGain` |
| `packages/foundry/contracts/PerpMarket.sol` | The market. Inherits `MarginAccount`, `ScheduledKeeper`, `Ownable`, `ReentrancyGuard`. `_work()` accrues funding, sweeps, refuels |
| `packages/foundry/contracts/LiquidityPool.sol` | USDC pool, creates and mints the cUSDC-LP HTS token at `0x167` |
| `packages/foundry/contracts/examples/Heartbeat.sol` | The smallest keeper |
| `packages/foundry/contracts/interfaces/` | `IHederaScheduleService`, `IHRC719`, `IAggregatorV3`, `ISupraSValueFeed`, `ISaucerSwapRouter` |
| `packages/foundry/test/` | Unit, fuzz and `invariant/` suites. `CustosBase.sol` is the shared fixture; `mocks/` has the HSS, HTS, oracle, ERC-20 and router mocks |
| `packages/foundry/scripts-js/custos.js` | Testnet CLI: `deploy`, `start`, `demo`, `revive`, `check-market`, each with `--market <NAME>` |
| `packages/foundry/scripts-js/checkMarkets.js` | Offline check of `markets.json` against the limits `PriceGuard` enforces; no network, no keys |
| `packages/foundry/markets.json` | One entry per market: Chainlink feed, Supra feed and pair, staleness, deviation, `refPrice8` |
| `packages/foundry/deployments/296.json` | The default market's testnet addresses (written by `custos.js`) |
| `packages/foundry/script/Deploy.s.sol` | Local-chain deploy with mocks only. Not for Hedera |
| `packages/nextjs/app/` | Pages; each page keeps its parts in `_components/` and `_lib/` |
| `packages/nextjs/hooks/custos/` | Contract and mirror-node reads shared by the pages; `poll.ts` holds `POLL` |
| `packages/nextjs/components/custos/` | Shared Custos components (oracle readout, testnet proof, install command) |
| `packages/nextjs/utils/custos/` | `perpMath.ts` (the app's previews of contract math, checked by `perpMath.check.mjs`), `testnet.ts` (proof links) |
| `packages/nextjs/contracts/deployedContracts.ts` | Generated ABIs and addresses. Never edit by hand |
| `packages/nextjs/contracts/externalContracts.ts` | The oracles the app reads directly: `ChainlinkHbarUsd`, `SupraPushOracle` |
| `packages/nextjs/e2e/` | Playwright smoke test; `routes.ts` lists the routes |
| `scripts/` | `check-docs.mjs` (doc drift), `check-template.mjs`, `check-scaffold.sh` |

## Commands

```bash
# Contracts
yarn foundry:compile
yarn foundry:test                     # 213 tests incl. the invariant suite; no network
yarn foundry:lint                     # forge fmt --check + prettier on scripts-js
yarn foundry:format
yarn workspace @sh/foundry check-markets ETH-USD     # offline: every market inside PriceGuard's limits; fails if ETH-USD is missing

# Testnet (spends HBAR; needs forge and cast on PATH)
yarn foundry:account:generate         # or yarn foundry:account:import
yarn custos:deploy:testnet            # PriceGuard → LiquidityPool → PerpMarket, link, create cUSDC-LP, fund keeper
yarn custos:start:testnet             # associate pool + market with USDC, book the first tick
yarn custos:demo:testnet              # seed the pool via SaucerSwap, open a 50x long with 1 HBAR
yarn custos:revive:testnet            # restart a broken chain (only works once overdue)
yarn custos:check-market:testnet --market ETH-USD   # deploy only a PriceGuard and read both live feeds

# App
yarn next:dev                         # http://localhost:3000
yarn next:lint
yarn next:check-types
yarn next:build
yarn next:e2e:install                 # once
yarn next:e2e                         # after next:build

# Everything
yarn lint
yarn format
yarn docs:check                       # README.md and AGENTS.md may only name things that exist
```

`custos.js` signs with `--keystore <name>`, `ETH_KEYSTORE_ACCOUNT`, or `DEPLOYER_PRIVATE_KEY` from the shell. It reads its variables (`KEEPER_INTERVAL`, `KEEPER_GAS_LIMIT`, `KEEPER_GAS_PRICE`, `KEEPER_FUND`, `MIN_COLLATERAL`, `MAX_SWAP_DEVIATION_BPS`, `SHARE_TOKEN_FEE`, `DEMO_POOL_HBAR`, `DEMO_TRADE_HBAR`, `HEDERA_RPC_URL`) from the shell environment, not from `packages/foundry/.env`. Never write a private key into a file.

Do not use `yarn foundry:deploy --network hedera_testnet` for Custos: `forge script` can't deploy through the Hedera relay or simulate HSS/HTS. Use the `custos:*` scripts. A local deploy (`yarn foundry:chain`, then `yarn foundry:deploy`) still goes through the Makefile, so it needs `make`: use Git Bash or WSL on Windows.

## Invariants: do not break these

1. **Units.** Size in the asset's units at 1e18 (+ long, − short). Price in USD per unit at 1e18. Money in USDC at 6 dp; `size × price / 1e30` is USDC. HBAR inside the EVM is tinybars (1e8): `msg.value`, balances, `tx.gasprice`. Chainlink (8 dp) and Supra (its own decimals) are scaled to 1e18 inside `PriceGuard`, nowhere else.
2. **Only the network ticks.** `tick()` must keep `msg.sender == address(this)` as its only caller check: a scheduled call runs as the contract itself. Don't add an owner or keeper role to it, and don't relax `TIMESTAMP_TOLERANCE` (5 s) beyond what Hedera's block-start lag needs.
3. **The gas floor.** `SCHEDULE_GAS_RESERVE` is 1,600,000: booking the next tick costs ~1.41M gas. `_work()` runs with `gasleft() − 1.6M`, and gas limits at or below 1.6M are rejected. Any new `_work()` must fit in `gasLimit − 1,600,000`, and any loop in it must stop early on low gas (see `SWEEP_GAS_PER_TRADER`) and resume next tick.
4. **The chain must never break on a job failure.** `_work()` runs through the `runWork()` self-call so its revert is caught and the next tick is still booked. Keep it that way. Don't call `runWork()`, `tick()` or `revive()` from `_work()`.
5. **Hedera holds the whole gas limit up front, then charges the gas used.** A run only starts if the reserve holds `gasLimit × gasPrice`. `runCostEstimate()` is that hold; `runsLeft()` and `canPayNextRun()` count full holds. Don't "optimise" these to the average charge: a run the reserve can't hold never starts.
6. **Reentrancy.** Every user entry point that moves tokens is `nonReentrant`: `open`, `openWithHbar`, `close`, `closeToHbar`, `addCollateral`, `liquidate` in `PerpMarket`; `deposit`, `redeem`, `withdraw`, `createShareToken` in `LiquidityPool`. `tick()` and `revive()` have their own `_ticking` guard. A new state-changing entry point gets `nonReentrant` too.
7. **Never act on a bad price.** Opens, manual liquidations, refuels and the sweep require `PriceGuard` status `Ok`. Closes may use a bad price only through `closePrice()` (the feed worse for the trader). The pool refuses deposits and withdrawals while positions are open and the price isn't `Ok`.
8. **HTS association.** An account must be associated with an HTS token before it can receive it. The pool and the market each call `associate()` on USDC once (`custos:start:testnet` does it). Users associate with USDC and cUSDC-LP through the token's HIP-719 `associate()` (`useHtsToken` in the app). Redeem and withdraw need an approval of the pool on cUSDC-LP; the pool pulls the shares, then burns them. A failed HTS call reverts `LiquidityPool__HtsFailed` with the response code (184 is `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`).
9. **The pool must stay solvent.** Open interest ≤ 50% of pool USDC (`MAX_OPEN_INTEREST_BPS`); withdrawals stop at `requiredLiquidity()` (2 × open interest); each position's gain is capped at its entry notional; `payKeeper` only spends `freeAssets()`. The invariant suite checks all of it.
10. **No admin can move user funds.** Owners may only tune bounded parameters (`setGasPrice`, `setParams` within `MAX_STALENESS_LIMIT` and `MAX_DEVIATION_LIMIT_BPS`) and do one-time setup (`setMarket`, `createShareToken`). Keep it that way.
11. **24 KB size limit.** `PerpMarket` is 17,416 bytes with the optimizer at 200 runs (`forge build --sizes`). Check sizes after adding code; the relay rejects oversize contracts as `CONTRACT_EXECUTION_EXCEPTION`.

## Recipes

### Recipe 1: Add a market (e.g. ETH-USD)

A market is a `PriceGuard` config plus its own pool and market. **No contract changes**: if you think one is needed, the recipe is wrong. The `.harness/` recipe ([`.harness/prd.md`](.harness/prd.md)) grades exactly these steps.

1. **Config.** Add an entry to `packages/foundry/markets.json`, next to `"HBAR-USD"` (leave HBAR-USD exactly as it is):
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
   Chainlink ETH/USD on Hedera testnet (8 dp); the same Supra push-oracle contract HBAR-USD uses, pair 19 (ETH/USDT). Supra's testnet ETH/USDT was seen 8 h old, so testnet needs the guard's 1-day maximum (86400 s); use about 3600 on mainnet. Pairs 0 and 1 are stale; don't use them. `refPrice8` is the price, 8 dp, the tests run the market at ($2,700 here).
2. **Offline check:** `yarn workspace @sh/foundry check-markets ETH-USD`. It checks every entry against `PriceGuard`'s limits (`MAX_STALENESS_LIMIT`, `MAX_DEVIATION_LIMIT_BPS`) and fails if ETH-USD is missing. No network, no keys.
3. **Test.** `test/Markets.t.sol` reads `markets.json` and already runs **every** market through a full cycle at its `refPrice8` (the guard accepts the config, a long and a short open, the network liquidates the long on a 15% drop, the short closes, the pool's books balance). For ETH-specific numbers add `packages/foundry/test/markets/EthUsdMarket.t.sol`: read the ETH-USD entry from `markets.json` (don't hard-code it), and on mocks check that the guard reads `Ok` and scales an 8-dp $2,700 to 1e18, that 1,000 USDC of notional is sized `1000e6 * 1e30 / price`, that a 10x long's liquidation price is about 9% below entry and `isLiquidatable` there, that the network liquidates it on the next `tick()` (prank as the market), and that a short closes at a profit after ETH falls, paid by the pool. Run `yarn workspace @sh/foundry test --match-path test/markets/EthUsdMarket.t.sol`, then `yarn foundry:test`. <!-- drift-ignore -->
4. **Docs.** Add an `ETH-USD` row to the markets table in `README.md` (under Configuration), in the same columns as the `HBAR-USD` row, and note there that mainnet should use about 3600 s staleness. Run `yarn docs:check`.
5. **Live feeds:** `yarn custos:check-market:testnet --market ETH-USD`. It deploys only a `PriceGuard` (a little HBAR; it signs with `DEPLOYER_PRIVATE_KEY` from the environment or a keystore), prints both prices and the status, and exits 1 if either feed doesn't answer.
6. **Deploy (optional, out of scope for the harness):** `yarn custos:deploy:testnet --market ETH-USD`, then `yarn custos:start:testnet --market ETH-USD`. The addresses go to `deployments/296-<name>.json` (lower-case name); `deployedContracts.ts` and the app keep showing HBAR-USD.

Verify: `check-markets` passes, `yarn foundry:test` passes, `custos:check-market:testnet` prints "Both feeds answer", `yarn foundry:lint` and `yarn docs:check` pass.

The app is HBAR-USD only: `hooks/custos/usePriceFeeds.ts` hard-codes Supra pair 75 and the 7200 s / 500 bps limits, and `externalContracts.ts` names `ChainlinkHbarUsd`. Don't add a market switcher as part of this recipe.

### Recipe 2: Reuse the engine for lending

Keep `ScheduledKeeper` and `PriceGuard`; write the loan book.

```solidity
contract LendingMarket is ScheduledKeeper {
    PriceGuard public immutable guard;
    mapping(address => Loan) internal loans;
    address[] internal borrowers;

    constructor(PriceGuard guard_) ScheduledKeeper(3600, 3_000_000, 82) { guard = guard_; }

    function _work() internal override {
        (uint256 price, PriceGuard.Status status,,,) = guard.read();
        _accrueInterest();                          // the network charges interest every hour
        if (status != PriceGuard.Status.Ok) return; // never liquidate at a bad price
        // page through `borrowers` like PerpMarket._sweep, liquidating loans under their health factor
    }
}
```

- Copy `PerpMarket._sweep` for paging: a cursor plus a gas floor, so a big book spreads over several ticks (invariant 3).
- Copy `LiquidityPool.createShareToken` and `_mint` / `_burn` / `_send` if lenders should hold a real HTS token, and its value-before-deposit logic (`_syncMarket`) to stop deposit/withdraw sandwiches.
- Put the new contract in `packages/foundry/contracts/`, tests in `packages/foundry/test/` extending the pattern in `CustosBase.sol` (`vm.etch` the `MockHederaScheduleService` at `0x16b`, `htsSetup()` for HTS).

Verify: a test that ticks the way the network does (`vm.prank(address(market)); market.tick();`, as `CustosBase._tick` does), a test that a stale price liquidates nothing, and `yarn foundry:test`.

### Recipe 3: Add a keeper job

Override `_work()` in any `ScheduledKeeper`. `packages/foundry/contracts/examples/Heartbeat.sol` is the minimal version:

```solidity
contract MyJob is ScheduledKeeper {
    constructor() ScheduledKeeper(600, 2_000_000, 82) {} // every 10 min, 2M gas, 82 tinybar/gas to start
    function _work() internal override { /* the job: a revert here is caught, the next tick is still booked */ }
    function _keepGoing() internal view override returns (bool) { return true; } // false ends the chain
}
```

Deploy it the way `custos.js` deploys (`forge create` and `cast send`, legacy transactions):

```bash
forge create contracts/MyJob.sol:MyJob --rpc-url https://testnet.hashio.io/api --account <keystore> --legacy --broadcast
cast send <address> "fund()" --value 10ether --rpc-url https://testnet.hashio.io/api --account <keystore> --legacy
cast send <address> "revive()" --gas-limit 2500000 --rpc-url https://testnet.hashio.io/api --account <keystore> --legacy
```

`revive()` books the first tick; from there the network runs it. Keep `_work()` under `gasLimit − 1,600,000` gas, and keep at least `gasLimit × gasPrice` tinybars in it: Hedera holds that much before each run, then charges only the gas used (`runsLeft()` counts full holds). To add work to the perp market itself, extend `PerpMarket._work()`; it already accrues funding, sweeps and refuels.

Verify: tests for the job and for a reverting job still booking the next tick (`ScheduledKeeper.t.sol` has the pattern), `yarn foundry:test`; on testnet, the schedule from `revive()` executes on HashScan and the next one appears.

### Recipe 4: Change the interval

The interval is `immutable`, set at deploy: `KEEPER_INTERVAL=3600 yarn custos:deploy:testnet`. Weigh:

- **Cost:** each run is charged for the gas it uses (~1.36 ℏ for a tick that sweeps a small book and books the next one), so halving the interval roughly doubles the HBAR spent: ~65 ℏ a day at 30 minutes. The reserve must still hold a full `gasLimit × gasPrice` before each run.
- **Safety:** at 50x a ~2% move wipes a position. The sweep checks 50 positions a tick, so a slower interval leaves underwater positions waiting longer and the pool takes the slack. Manual liquidators can still call `liquidate()` any time, for the 0.5% reward.
- **Funding** accrues continuously; the interval only decides when it's booked.

Verify: `interval()` on the new market, and on `/keeper` the countdown and "every N minutes" text follow it (they read `interval` from the contract).

## How the frontend reads contracts

- **Addresses and ABIs** come from `packages/nextjs/contracts/deployedContracts.ts`, regenerated by `custos:deploy:testnet` (default market only) through `scripts-js/generateTsAbis.js`. Never hand-edit it. Third-party contracts (the two oracles) are in `externalContracts.ts`.
- **Reads** use Scaffold-HBAR's hooks from `~~/hooks/scaffold-hbar`: `useScaffoldReadContract`, `useScaffoldWriteContract`, `useDeployedContractInfo`, `useTargetNetwork`. Use those names exactly.
- **Custos hooks** in `hooks/custos/` wrap them per concern: `useKeeper` and `useKeeperHealth` (schedule, reserve, `canPayNextRun`), `useKeeperActivity` (history), `usePriceFeeds` and `useTradeMarket` (prices, guard status, constants), `useTradePosition`, `useTradeAction` (writes, with `humanizeTradeError` turning any revert into one sentence), `usePool`, `usePoolShares`, `usePoolEarnings`, `useHtsToken` (HTS association and approvals). Reuse them before writing a new read.
- **Polling.** Every Custos read spreads `POLL` from `hooks/custos/poll.ts` (`watch: false`, refetch every 30 s). The stock template re-reads every block (~2 s), which floods the public relay. New reads must use `POLL` too; constants that never change can be read once.
- **History comes from the mirror node**, not `eth_getLogs` (the public relay limits log ranges). `useKeeperActivity` reads `/contracts/<id>/results/logs` and `/transactions?account.id=<id>`, decodes logs against the `PerpMarket` ABI, and marks a run as network-executed when the mirror node says `scheduled: true`. Don't infer "the network did it" from the mirror node's `from`: it shows the relay operator.
- **Writes** simulate first where a revert is likely (see `app/pool/_lib/usePoolWrite.ts`) and pass explicit gas: Hedera's estimates fall short for HTS and HSS calls.
- **Previews** of contract math live in `utils/custos/perpMath.ts`. If you change a formula in `MarginAccount` or `PerpMarket`, change it there too and run `node --experimental-strip-types utils/custos/perpMath.check.mjs` from `packages/nextjs`.
- UI: `@scaffold-hbar-ui/components`, DaisyUI classes, the `~~` import alias, `"use client"` for pages that use hooks. Prefer `type` over `interface`.

## Testing rules

- Every contract change comes with a test in `packages/foundry/test/`. Fixes come with a regression test that replays the failure, as the audit fixes do.
- Tick the way the network does: prank as the market itself (`CustosBase._tick`). A test that ticks from any other address is testing the wrong thing.
- New risk or pool logic must keep `test/invariant/Solvency.t.sol` green (256 runs × 50 calls, `fail_on_revert = true`). If you add a user action, add it to `test/invariant/Handler.sol`.
- A new market is covered by `test/Markets.t.sol` automatically; don't special-case it.
- Before you finish: `yarn foundry:test`, `yarn lint`, `yarn next:check-types`, `yarn docs:check`. CI runs these plus the Playwright smoke test, gitleaks and a fresh scaffold with Yarn and npm.
- A new page gets a line in `packages/nextjs/e2e/routes.ts`.

## Docs rules

- `yarn docs:check` fails when `README.md` or `AGENTS.md` names a contract, file, script or route that doesn't exist. Keep it green; fix the doc, not the checker.
- Every number in the docs comes from a test, a measurement or a HashScan transaction. Don't add proof links you haven't checked on the mirror node.
- Write `yarn <script>` only where a command is meant: the scaffold CLI rewrites it for npm projects.
- If you redeploy, update `packages/foundry/TESTNET.md` and `packages/nextjs/utils/custos/testnet.ts` with the new ids.
