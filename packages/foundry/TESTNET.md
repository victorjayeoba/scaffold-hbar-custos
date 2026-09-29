# Custos on Hedera testnet

Everything below can be checked on HashScan. Addresses are also in [`deployments/296.json`](deployments/296.json).

## Deployment

| Contract | Hedera ID | EVM address |
| --- | --- | --- |
| PriceGuard | [0.0.10776695](https://hashscan.io/testnet/contract/0.0.10776695) | `0x7c7a9C1af0C390233C8BC655CAc714EAdA4bFEa0` |
| LiquidityPool (cUSDC-LP) | [0.0.10776700](https://hashscan.io/testnet/contract/0.0.10776700) | `0xFF20a2f37d097918404B1482c6E153784baf87F0` |
| PerpMarket (keeper) | [0.0.10776702](https://hashscan.io/testnet/contract/0.0.10776702) | `0xB934afcA21c9Fc3d7808e23d25581490F350C03E` |

Keeper: interval 1,800 s, gas limit 2,500,000, 40 ℏ fee reserve. PriceGuard: max staleness 7,200 s, max deviation 500 bps.
First tick booked on the Schedule Service as [0.0.10776713](https://hashscan.io/testnet/schedule/0.0.10776713).

## The network keeps the market

Every tick below was executed by the Schedule Service from a schedule the previous tick booked. No one signed them.

| Tick | Schedule | Executed | What it did |
| --- | --- | --- | --- |
| 1 | [0.0.10776713](https://hashscan.io/testnet/schedule/0.0.10776713) | [1790687748.000592261](https://hashscan.io/testnet/transaction/1790687748.000592261) | Funding accrued, swept 2 traders, none underwater |
| 2 | [0.0.10777055](https://hashscan.io/testnet/schedule/0.0.10777055) | [1790689547.018645425](https://hashscan.io/testnet/transaction/1790689547.018645425) | Swept 2 traders, none underwater yet |
| 3 | [0.0.10777398](https://hashscan.io/testnet/schedule/0.0.10777398) | [1790691346.057913123](https://hashscan.io/testnet/transaction/1790691346.057913123) | **Liquidated** the 50x long `0xA807…6Ec6` at 0.11304294 (liquidation price 0.11353): `Liquidated(byNetwork = true, reward = 0)`, all 0.1425 USDC collateral to the pool |

Tick 3 ran one second before its `nextRunAt` (Hedera's block timestamp lag), which the 5 s tolerance absorbs.

## The keeper books itself (Heartbeat, M1)

[`Heartbeat`](contracts/examples/Heartbeat.sol) [0.0.10776628](https://hashscan.io/testnet/contract/0.0.10776628) ticked three times, 60 s apart, each run executed by the network from a schedule the previous run created:

| Tick | Schedule | Executed | Paid by the contract |
| --- | --- | --- | --- |
| 1 | [0.0.10776630](https://hashscan.io/testnet/schedule/0.0.10776630) | [1790685471.038694104](https://hashscan.io/testnet/transaction/1790685471.038694104) | 1.663 ℏ (includes booking tick 2) |
| 2 | [0.0.10776638](https://hashscan.io/testnet/schedule/0.0.10776638) | [1790685529.003290433](https://hashscan.io/testnet/transaction/1790685529.003290433) | 1.607 ℏ (includes booking tick 3) |
| 3 | [0.0.10776648](https://hashscan.io/testnet/schedule/0.0.10776648) | [1790685588.032277208](https://hashscan.io/testnet/transaction/1790685588.032277208) | 0.066 ℏ (last beat, books nothing) |

## Learned on testnet

- **Booking a schedule costs ~1.41M gas** (`scheduleCall`, measured with 300k and 1M scheduled gas limits: same cost; 800k total fails).
  A keeper's own gas limit must cover booking the next tick, so `ScheduledKeeper` holds back 1.5M gas from `_work()` and rejects limits at or below it.
  At 114 tinybar/gas that is ~1.6 ℏ per tick, paid from the contract's balance.
- **`block.timestamp` is the start of Hedera's ~2 s block.** A schedule that fired exactly at `nextRunAt` (…974.119) ran in a block that started at …973.34, so the first version reverted `TooEarly`. `tick()` now accepts up to 5 s early.
- **Supra's testnet HBAR/USDT pushes about hourly** and quotes USDT, so it can sit 3% from Chainlink's HBAR/USD for a while. Staleness is 2 h and deviation 5% on testnet.
- **`forge script` cannot deploy through the Hedera JSON-RPC relay** with current Foundry (the relay rejects the EIP-1898 block parameter forking sends), and cannot simulate HSS/HTS. `yarn custos:deploy:testnet` uses `forge create` and `cast send` instead.
