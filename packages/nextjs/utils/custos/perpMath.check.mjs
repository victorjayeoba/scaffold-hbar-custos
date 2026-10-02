/**
 * Self-check for perpMath.ts: worked examples taken from packages/foundry/test/PerpMarket.t.sol, where the
 * contract's own answers are asserted. If these pass, the page previews what the contract computes.
 *
 * Run from packages/nextjs:
 *   node --experimental-strip-types utils/custos/perpMath.check.mjs
 */
import {
  CONTRACT_DEFAULTS as P,
  closePrice,
  closeableAt,
  equity,
  fundingOwed,
  isLiquidatable,
  liquidationPrice,
  minOutAfterSlippage,
  openedLeverage,
  pendingFundingIndex,
  pnl,
  previewClose,
  previewOpen,
} from "./perpMath.ts";
import assert from "node:assert/strict";

const e6 = n => BigInt(Math.round(n * 1e6));
const POOL_SEED = e6(10_000);
const PRICE = 12n * 10n ** 16n; // 0.12 USD per HBAR, 1e18
const asPosition = (o, openedAt = 0n) => ({
  size: o.size,
  collateral: o.collateral,
  entryPrice: o.entryPrice,
  entryNotional: o.notional,
  fundingIndex: 0n,
  openedAt,
});
let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log(`ok  ${name}`);
};

check("test_openLong: 100 USDC at 10x, price 0.12", () => {
  const o = previewOpen({
    isLong: true,
    collateral: e6(100),
    leverage: 10n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  assert.equal(o.size, (e6(1000) * 10n ** 30n) / PRICE);
  assert.equal(o.collateral, e6(99)); // 10 bps of 1,000 notional
  assert.equal(o.fee, e6(1));
  assert.equal(o.notional, e6(1000));
  assert.equal(o.blocker, undefined);
  assert.equal(openedLeverage(asPosition(o), P), 10n);
});

check("test_openShortHasNegativeSize: 100 USDC short at 5x", () => {
  const o = previewOpen({
    isLong: false,
    collateral: e6(100),
    leverage: 5n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  assert.ok(o.size < 0n);
  assert.equal(o.notional, e6(500));
});

check("test_openRejectsBadInput: zero, 0x and 51x revert; 50x opens", () => {
  const base = { isLong: true, price: PRICE, poolBalance: POOL_SEED, openInterest: 0n, params: P };
  assert.equal(previewOpen({ ...base, collateral: 0n, leverage: 10n }).blocker, "zero");
  assert.equal(previewOpen({ ...base, collateral: e6(10), leverage: 51n }).blocker, "leverage");
  assert.equal(previewOpen({ ...base, collateral: e6(10), leverage: 0n }).blocker, "leverage");
  assert.equal(previewOpen({ ...base, collateral: e6(10), leverage: 50n }).blocker, undefined);
});

check("test_openInterestCap: 501 USDC at 10x on a 10,000 pool reverts with cap 5,000", () => {
  const o = previewOpen({
    isLong: true,
    collateral: e6(501),
    leverage: 10n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  assert.equal(o.blocker, "cap");
  assert.equal(o.cap, e6(5000));
  assert.equal(o.maxCollateral, e6(500)); // exactly at the cap is allowed (the check is `>`)
  const atCap = previewOpen({
    isLong: true,
    collateral: e6(500),
    leverage: 10n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  assert.equal(atCap.blocker, undefined);
});

check("test_liquidationPriceMatchesIsLiquidatable: 10 USDC at 50x, both sides", () => {
  for (const isLong of [true, false]) {
    const o = previewOpen({
      isLong,
      collateral: e6(10),
      leverage: 50n,
      price: PRICE,
      poolBalance: POOL_SEED,
      openInterest: 0n,
      params: P,
    });
    const p = asPosition(o);
    const liq = liquidationPrice(p, 0n, P);
    assert.equal(liq, o.liquidationPrice);
    const step = 10n ** 12n;
    if (isLong) {
      // assertApproxEqRel(liq, 0.11892e18, 1e14): within 0.01%
      const target = 11892n * 10n ** 13n;
      const diff = liq > target ? liq - target : target - liq;
      assert.ok(diff * 10n ** 18n <= target * 10n ** 14n, `long liq ${liq}`);
      assert.equal(isLiquidatable(p, liq + step, 0n, P), false);
      assert.equal(isLiquidatable(p, liq - step, 0n, P), true);
    } else {
      assert.ok(liq > PRICE);
      assert.equal(isLiquidatable(p, liq - step, 0n, P), false);
      assert.equal(isLiquidatable(p, liq + step, 0n, P), true);
    }
  }
});

check("test_liquidateByAnyonePaysReward: the same long is liquidatable 1% lower, at 0.1188", () => {
  const o = previewOpen({
    isLong: true,
    collateral: e6(10),
    leverage: 50n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  assert.equal(o.collateral, e6(9.5));
  assert.equal(o.notional, e6(500));
  assert.equal(isLiquidatable(asPosition(o), 1188n * 10n ** 14n, 0n, P), true);
});

check("test_gainCappedAtNotional: 100 USDC at 2x, price 4x, equity = 99.8 + 200", () => {
  const o = previewOpen({
    isLong: true,
    collateral: e6(100),
    leverage: 2n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  const p = asPosition(o);
  // The test lets 300 s of funding accrue; the gain cap makes equity exact regardless.
  const owed = fundingOwed(p, pendingFundingIndex(0n, o.notional, 0n, POOL_SEED + o.fee, 300n, P));
  assert.equal(equity(p, 48n * 10n ** 16n, owed), e6(99.8) + e6(200));
});

check("test_fundingHeavySidePays: 1,000 long vs 200 short for an hour", () => {
  const long = previewOpen({
    isLong: true,
    collateral: e6(100),
    leverage: 10n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  const short = previewOpen({
    isLong: false,
    collateral: e6(100),
    leverage: 2n,
    price: PRICE,
    poolBalance: POOL_SEED + long.fee,
    openInterest: long.notional,
    params: P,
  });
  const assets = POOL_SEED + long.fee + short.fee; // fees went to the pool
  const index = pendingFundingIndex(0n, long.notional, short.notional, assets, 3600n, P);
  const aliceOwes = fundingOwed(asPosition(long), index);
  const bobOwes = fundingOwed(asPosition(short), index);
  assert.ok(aliceOwes > 0n && bobOwes < 0n);
  // assertApproxEqAbs(aliceOwes, 79_990, 20)
  assert.ok(aliceOwes >= 79_970n && aliceOwes <= 80_010n, `alice owes ${aliceOwes}`);
  assert.ok(aliceOwes + bobOwes > 0n); // net goes to the pool
});

check("test_closeLongInProfitPaidByPool: +10% on a 10x long pays equity minus a 1 USDC fee", () => {
  const o = previewOpen({
    isLong: true,
    collateral: e6(100),
    leverage: 10n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  const p = asPosition(o);
  const price = 132n * 10n ** 15n;
  const owed = fundingOwed(p, pendingFundingIndex(0n, o.notional, 0n, POOL_SEED + o.fee, 300n, P));
  const c = previewClose(p, price, owed, P);
  assert.equal(c.fee, e6(1));
  assert.equal(c.payout, equity(p, price, owed) - e6(1));
  assert.ok(c.payout > e6(99 + 98)); // ~+100 PnL, minus funding and fee
  assert.equal(pnl(p, price) > e6(99.99), true);
});

check("test_closeRespectsMinHold: closeable 300 s after opening", () => {
  assert.equal(closeableAt({ openedAt: 1_000n }, P), 1_300n);
});

check("test_openWithHbarSwapsToCollateral: 1% slippage on a 22.7 USDC quote", () => {
  assert.equal(minOutAfterSlippage(e6(22.7), 100n), e6(22.473));
  assert.equal(minOutAfterSlippage(e6(22.7), 0n), e6(22.7));
});

check("liquidationPrice: a short liquidates above entry by buffer / size; signed division truncates", () => {
  // Hand-worked: 10 USDC short at 50x, 0.12. notional 500, fee 0.5, kept 9.5, maintenance 5, buffer 4.5.
  // size = −500e6·1e30/0.12e18 = −4166.666…e18. liq = 0.12 + 4.5e6·1e30/4166.666…e18 = 0.12108 (truncated).
  const o = previewOpen({
    isLong: false,
    collateral: e6(10),
    leverage: 50n,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
  });
  const size = -((e6(500) * 10n ** 30n) / PRICE);
  assert.equal(o.size, size);
  assert.equal(o.liquidationPrice, PRICE - (e6(4.5) * 10n ** 30n) / size);
  assert.ok(o.liquidationPrice > 121079n * 10n ** 12n && o.liquidationPrice < 121081n * 10n ** 12n);
});

check("test_minCollateral (new market): 1 USDC floor, checked before leverage", () => {
  const base = {
    isLong: true,
    price: PRICE,
    poolBalance: POOL_SEED,
    openInterest: 0n,
    params: P,
    minCollateral: e6(1),
  };
  assert.equal(previewOpen({ ...base, collateral: e6(1) - 1n, leverage: 10n }).blocker, "belowMin");
  assert.equal(previewOpen({ ...base, collateral: e6(1) - 1n, leverage: 51n }).blocker, "belowMin");
  assert.equal(previewOpen({ ...base, collateral: e6(1), leverage: 10n }).blocker, undefined);
  // 0.1 HBAR swaps to 0.227 USDC: under the floor
  assert.equal(previewOpen({ ...base, collateral: e6(0.227), leverage: 10n }).blocker, "belowMin");
  // zero still reports ZeroAmount, as `open` checks it first
  assert.equal(previewOpen({ ...base, collateral: 0n, leverage: 10n }).blocker, "zero");
});

check("test_closeAtDeviatedPriceUsesTheWorseFeed / OneFeedDown (new market)", () => {
  const cl = 13n * 10n ** 16n;
  const su = 11n * 10n ** 16n;
  assert.equal(closePrice(true, cl, su, 2), su); // a long settles at the lower price
  assert.equal(closePrice(false, cl, su, 2), cl); // a short at the higher one
  assert.equal(closePrice(true, cl, su, 0), cl); // Ok: Chainlink
  assert.equal(closePrice(true, 0n, 125n * 10n ** 15n, 1), 125n * 10n ** 15n); // Chainlink down: Supra
  assert.equal(closePrice(false, 0n, 0n, 1), 0n); // nothing answers: PerpMarket__NoPrice
});

console.log(
  `\n${checks} checks passed: perpMath.ts matches PerpMarket.sol (deployed and contracts@b059795) on the worked examples.`,
);
