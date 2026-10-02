# Custos contracts (Foundry)

A margin engine the Hedera network keeps: an HBAR-USD perpetual market whose liquidations and funding are run by the Hedera Schedule Service (HIP-1215), priced by Chainlink and cross-checked by Supra, with an LP share token minted on the Hedera Token Service and SaucerSwap for the HBAR legs.

- **How it works, what it costs, what we learned on testnet, error codes, limits and recipes:** [`CONTRACTS_NOTES.md`](CONTRACTS_NOTES.md)
- **Proof on Hedera testnet (contracts, every flow, network-run ticks):** [`TESTNET.md`](TESTNET.md)

## Contracts

| File | What it is |
|---|---|
| [`contracts/ScheduledKeeper.sol`](contracts/ScheduledKeeper.sol) | Abstract: runs `_work()` every `interval` seconds by booking its own next `tick()` on the Schedule Service. Network-only tick, capacity probing, gas-hold accounting, `revive()` |
| [`contracts/PriceGuard.sol`](contracts/PriceGuard.sol) | Chainlink price, Supra cross-check, `Ok` / `Stale` / `Deviated` |
| [`contracts/MarginAccount.sol`](contracts/MarginAccount.sol) | Abstract: position book, PnL, funding, liquidation math, O(1) running sums |
| [`contracts/PerpMarket.sol`](contracts/PerpMarket.sol) | The market: trading, the network sweep, SaucerSwap open-with-HBAR / close-to-HBAR / keeper refuel |
| [`contracts/LiquidityPool.sol`](contracts/LiquidityPool.sol) | USDC in, cUSDC-LP (an HTS token it creates and mints) out; every trader's counterparty |
| [`contracts/examples/Heartbeat.sol`](contracts/examples/Heartbeat.sol) | The smallest keeper: start here for your own scheduled job |
| [`markets.json`](markets.json) | Market configs (feeds, Supra pair, staleness, deviation) |

## Commands (from the repo root)

| Command | Does |
|---|---|
| `yarn foundry:test` | All tests and invariants (no network needed: Hedera's Token Service is emulated, the Schedule Service mocked) |
| `yarn foundry:lint` | `forge fmt --check` and prettier |
| `yarn workspace @sh/foundry check-markets [NAME]` | Checks `markets.json` offline |
| `yarn custos:check-market:testnet --market NAME` | Deploys only a PriceGuard for that market and reads both live feeds |
| `yarn custos:deploy:testnet` | Deploys PriceGuard → LiquidityPool → PerpMarket, creates the HTS share token, funds the keeper, regenerates the app's ABIs |
| `yarn custos:start:testnet` | Associates the contracts with USDC and books the keeper's first tick |
| `yarn custos:demo:testnet` | Swaps HBAR to USDC on SaucerSwap, seeds the pool, opens a 50x long with HBAR |
| `yarn custos:revive:testnet` | Restarts the keeper if its chain stopped (after `fund()` if the reserve ran low) |

The testnet commands sign with `--keystore <name>` (or `ETH_KEYSTORE_ACCOUNT`), or `DEPLOYER_PRIVATE_KEY` from the environment. Never write a key into a file. Options (interval, gas limit, reserve, minimum collateral, refuel band) are listed at the top of [`scripts-js/custos.js`](scripts-js/custos.js).

`forge script` can't deploy through the Hedera JSON-RPC relay or simulate the Schedule and Token services, so the testnet path uses `forge create` and `cast send`. `script/Deploy.s.sol` deploys to a local anvil chain with mocks and stand-ins for the two system contracts: trading and the pool work locally, the keeper only runs on Hedera.
