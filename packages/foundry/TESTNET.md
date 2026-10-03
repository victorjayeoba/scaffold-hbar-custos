# Custos on Hedera testnet

Everything below can be checked on HashScan. HashScan opens a transaction from its EVM hash: `https://hashscan.io/testnet/transaction/<hash>`. Addresses are also in [`deployments/296.json`](deployments/296.json). What each item means, and what it cost, is in [`CONTRACTS_NOTES.md`](CONTRACTS_NOTES.md).

## Deployment (final, 2026-10-02)

| Contract | Hedera ID | EVM address |
| --- | --- | --- |
| PerpMarket (keeper) | [0.0.10833087](https://hashscan.io/testnet/contract/0.0.10833087) | `0xb79Cc40A4b1d3C135f71Ed6dc4e9a231cC369b67` |
| LiquidityPool | [0.0.10833082](https://hashscan.io/testnet/contract/0.0.10833082) | `0x06061a60D2f9E99410F1D2B310DCF51A1ff2A3b1` |
| PriceGuard | [0.0.10833074](https://hashscan.io/testnet/contract/0.0.10833074) | `0x293e90142cc9dDF603d9Ab405B43236e8077EF75` |
| cUSDC-LP share token (HTS, created by the pool) | [0.0.10833090](https://hashscan.io/testnet/token/0.0.10833090) | `0x0000000000000000000000000000000000a54cc2` |
| HbarDepositZap (LPs deposit with HBAR via SaucerSwap) | [contract](https://hashscan.io/testnet/contract/0xdD40EBFf88aaDc52B31D9E698803e47B04Ef185C) | `0xdD40EBFf88aaDc52B31D9E698803e47B04Ef185C` |

Source verified on [Sourcify](https://sourcify.dev): LiquidityPool exact match; PerpMarket and PriceGuard match (identical bytecode, source reformatted after the deploy).

Keeper: interval 1,800 s, gas limit 3,000,000, gas price 82 tinybar/gas (2.46 ℏ held per run), 36 ℏ reserve. PriceGuard: Chainlink HBAR/USD checked against Supra HBAR/USDT (pair 75), max staleness 43,200 s (raised from 7,200 s on 3 Oct with [`setParams`](https://hashscan.io/testnet/transaction/0x51cf5b7fd2d41425ba7599b54992e4396cbc04431ea47c6c3ae3ea3e3b6745fc): Chainlink's testnet HBAR/USD goes hours between pushes), max deviation 500 bps. Min collateral 1 USDC. Refuel band 300 bps. Collateral: SaucerSwap testnet USDC 0.0.5449.

## Every flow, on chain

| Flow | Transaction |
| --- | --- |
| Pool creates its HTS share token (cUSDC-LP) | [`0xf405eade…340a5a`](https://hashscan.io/testnet/transaction/0xf405eadedf1ddd1e99b615a619ae451d0f5b78dd049fb8bfb84189e681340a5a) |
| Keeper books its first tick (`revive`) | [`0xa1b7d249…fa1b71`](https://hashscan.io/testnet/transaction/0xa1b7d249013f1f2812b4176ccc234f54fc0a2f0dc48270cd7f2bdd26e8fa1b71), schedule [0.0.10833097](https://hashscan.io/testnet/schedule/0.0.10833097) |
| Deposit 361.79 USDC, pool mints cUSDC-LP | [`0x55d081b2…54d722`](https://hashscan.io/testnet/transaction/0x55d081b26535e7c9ef68664a080f0609a7caacab03becc115ee7180e1154d722) |
| Open with HBAR: 50x long, 1 ℏ swapped to USDC on SaucerSwap | [`0x62868b09…3986e7`](https://hashscan.io/testnet/transaction/0x62868b097e839fdeeef472c7fd8ff26f58a3ddd410924b825f2855d75e3986e7) |
| Open with USDC: 50x short, 1.2 USDC | [`0xfac6b7ec…7bdba`](https://hashscan.io/testnet/transaction/0xfac6b7ecccee1f124fd9eb56be2f9657a8457dee24ccef923c2f434abbb7bdba) |
| Open with USDC: 2x long, 1 USDC | [`0xd3f325cf…443de8`](https://hashscan.io/testnet/transaction/0xd3f325cf8191e5e197b9af1f45a9ab90173079181724f9f331bb603726443de8) |
| Close, paid out in USDC | [`0xbaa65216…c61df6`](https://hashscan.io/testnet/transaction/0xbaa65216cdb2988c3164ae25193927e622255133d6866d3c46605d6f83c61df6) |
| Close straight to HBAR: the USDC payout swapped on SaucerSwap (`closeToHbar`) | [`0x1e427e54…d91c36`](https://hashscan.io/testnet/transaction/0x1e427e54abd7594d815afa933b1dbacb31ec45ca6f5133f9b416801117d91c36) |
| Deposit with HBAR: 0.5 ℏ swapped to 1.12 USDC on SaucerSwap and deposited for the caller (`HbarDepositZap.depositWithHbar`), 1,114,696 cUSDC-LP minted to them | [`0x3c23d3b3…36ca098`](https://hashscan.io/testnet/transaction/0x3c23d3b3cdf4058d5843f06be3d66af91e35c886af53370437cb5d21636ca098) |
| Redeem 10 cUSDC-LP, pool burns the shares | [`0x90487242…2d7422`](https://hashscan.io/testnet/transaction/0x9048724259694f86a20fa69aa069a89d3e85045703b0a6f1a9b302d66c2d7422) |

## The network keeps the market

Each tick is executed by the Schedule Service from a schedule the previous tick booked; `msg.sender` is the market itself, and no one signs it.

| Tick | Executed | What it did |
| --- | --- | --- |
| 1 | [`0x5bebf1d8…0038f6`](https://hashscan.io/testnet/transaction/0x5bebf1d891890489514a052be62988357a00dc621b9fa19a6fe09f80de0038f6) (schedule [0.0.10833097](https://hashscan.io/testnet/schedule/0.0.10833097), 1790983197.030564046) | Accrued funding, swept the 2 open positions (none underwater), recorded the gas price it ran at (84 tinybar/gas), booked tick 2. Paid by the market itself: 1.359 ℏ for 1,618,265 gas |
| 2 | [`0x756e4e8e…8c518a`](https://hashscan.io/testnet/transaction/0x756e4e8e11bf69370a543a2d518e905c868aca2361ba606455b803140a8c518a) (1790984996.012) | Funding, sweep (none underwater), booked tick 3. 1.327 ℏ for 1,580,037 gas |
| 3 | [`0xcaaa44b5…0e38aef3`](https://hashscan.io/testnet/transaction/0xcaaa44b5a61366f099f2d334c571e1d578b198357ea07dc56c350c980e38aef3) (1790986794.024) | Funding, sweep (none underwater), booked tick 4. 1.315 ℏ for 1,584,087 gas |
| 4 | [`0x7c37d2a7…8dde59a9`](https://hashscan.io/testnet/transaction/0x7c37d2a7399f66bc85fe549a12766212d8622ed0a31911959c204e588dde59a9) (1790988593.014) | **Liquidated** the 50x short `0xebBA…F393` at $0.10277 (its liquidation price was $0.10266): `Liquidated(byNetwork = true, by = 0x0, reward = 0)`, all collateral to the pool. Nobody signed it. 1.980 ℏ for 2,385,537 gas |

## Earlier deploy: the first liquidation nobody signed (2026-09-29)

The first version (PerpMarket [0.0.10776702](https://hashscan.io/testnet/contract/0.0.10776702), since retired) proved the whole loop. Every tick below was executed by the Schedule Service from a schedule the previous tick booked.

| Tick | Schedule | Executed | What it did |
| --- | --- | --- | --- |
| 1 | [0.0.10776713](https://hashscan.io/testnet/schedule/0.0.10776713) | [1790687748.000592261](https://hashscan.io/testnet/transaction/1790687748.000592261) | Funding accrued, swept 2 traders, none underwater |
| 2 | [0.0.10777055](https://hashscan.io/testnet/schedule/0.0.10777055) | [1790689547.018645425](https://hashscan.io/testnet/transaction/1790689547.018645425) | Swept 2 traders, none underwater yet |
| 3 | [0.0.10777398](https://hashscan.io/testnet/schedule/0.0.10777398) | [1790691346.057913123](https://hashscan.io/testnet/transaction/1790691346.057913123) | **Liquidated** the 50x long `0xA807…6Ec6` at 0.11304294 (liquidation price 0.11353): `Liquidated(byNetwork = true, reward = 0)`, all 0.1425 USDC collateral to the pool. Charged 1.755 ℏ for 1.61M gas used of 2.5M |

Tick 3 ran one second before its `nextRunAt` (Hedera's block timestamp lag), which the 5 s tolerance absorbs. That deploy's chain later stopped with `INSUFFICIENT_PAYER_BALANCE`: Hedera holds a run's whole gas limit up front, and its 6M-gas runs needed more than the reserve held. The final deploy accounts for this (see CONTRACTS_NOTES.md §4.2).

## The keeper books itself (Heartbeat)

[`Heartbeat`](contracts/examples/Heartbeat.sol) [0.0.10776628](https://hashscan.io/testnet/contract/0.0.10776628) ticked three times, 60 s apart, each run executed by the network from a schedule the previous run created:

| Tick | Schedule | Executed | Paid by the contract |
| --- | --- | --- | --- |
| 1 | [0.0.10776630](https://hashscan.io/testnet/schedule/0.0.10776630) | [1790685471.038694104](https://hashscan.io/testnet/transaction/1790685471.038694104) | 1.663 ℏ (includes booking tick 2) |
| 2 | [0.0.10776638](https://hashscan.io/testnet/schedule/0.0.10776638) | [1790685529.003290433](https://hashscan.io/testnet/transaction/1790685529.003290433) | 1.607 ℏ (includes booking tick 3) |
| 3 | [0.0.10776648](https://hashscan.io/testnet/schedule/0.0.10776648) | [1790685588.032277208](https://hashscan.io/testnet/transaction/1790685588.032277208) | 0.066 ℏ (last beat, books nothing) |

## Probes (throwaway contracts that answered a question)

| Question | Contract | Answer |
| --- | --- | --- |
| Who is `msg.sender` when the Schedule Service runs a booked call? | `0xd603925b9c9F91ce5D4b48C55834a46730a6143b` | The contract itself (`msg.sender` and `tx.origin`) |
| What is `tx.gasprice` inside a scheduled run? | `0x2B8ac8aC37764617b96D940141A6f8f5f19b6d8e` | 82 (tinybars per gas) |
| Does Hedera hold the whole gas limit before a scheduled run? | same | Yes: a 5M-gas run with 3.6 ℏ in the contract failed `INSUFFICIENT_PAYER_BALANCE` (needs 4.1 ℏ), schedule [0.0.10832561](https://hashscan.io/testnet/schedule/0.0.10832561); the failed attempt cost 0.018 ℏ |
