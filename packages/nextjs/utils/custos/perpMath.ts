/**
 * PerpMarket's math, line for line, in bigint. The trade page previews what the contract will do with these, so
 * every formula here mirrors a line of `MarginAccount.sol` or `PerpMarket.sol` (cited on each function) and uses
 * the same integer division. Solidity's signed division truncates toward zero, and so does bigint's, so results
 * match to the last unit.
 *
 * Units, as in the contract:
 * - money (collateral, notional, fees, PnL): USDC with 6 decimals
 * - price: USD per HBAR with 18 decimals
 * - size: HBAR with 18 decimals, positive for a long, negative for a short
 * - funding index and rate: 1e18 = 100%
 *
 * Self-check: `node --experimental-strip-types utils/custos/perpMath.check.mjs` (from packages/nextjs).
 * This file must stay free of imports and TypeScript-only runtime syntax (enums, namespaces) so Node can run it.
 */

export const BPS = 10_000n;
/** `USDC_PER_SIZE_PRICE`: size (1e18) × price (1e18) / 1e30 = USDC (1e6). */
export const USDC_PER_SIZE_PRICE = 10n ** 30n;
export const WAD = 10n ** 18n;
const SECONDS_PER_HOUR = 3600n;

/** The market's risk constants. Read them from the contract; these defaults are its current values. */
export type MarketParams = {
  maxLeverage: bigint;
  openFeeBps: bigint;
  closeFeeBps: bigint;
  maintenanceBps: bigint;
  maxOpenInterestBps: bigint;
  minHoldSeconds: bigint;
  fundingFactorPerHour: bigint;
};

export const CONTRACT_DEFAULTS: MarketParams = {
  maxLeverage: 50n,
  openFeeBps: 10n,
  closeFeeBps: 10n,
  maintenanceBps: 100n,
  maxOpenInterestBps: 5_000n,
  minHoldSeconds: 300n,
  fundingFactorPerHour: 10n ** 15n,
};

/** `MarginAccount.Position`. */
export type Position = {
  size: bigint;
  collateral: bigint;
  entryPrice: bigint;
  entryNotional: bigint;
  fundingIndex: bigint;
  openedAt: bigint;
};

/*//////////////////////////////////////////////////////////////
                          POSITION MATH
//////////////////////////////////////////////////////////////*/

/** `MarginAccount.pnl`: size × (price − entry) / 1e30. Before funding and the gain cap. */
export const pnl = (p: Pick<Position, "size" | "entryPrice">, price: bigint) =>
  (p.size * (price - p.entryPrice)) / USDC_PER_SIZE_PRICE;

/** `MarginAccount.fundingOwed`: positive means the trader owes, negative means they are owed. */
export const fundingOwed = (p: Position, currentFundingIndex: bigint) => {
  if (p.size === 0n) return 0n;
  const owed = ((currentFundingIndex - p.fundingIndex) * p.entryNotional) / WAD;
  return p.size > 0n ? owed : -owed;
};

/** `MarginAccount.maintenanceMargin`. */
export const maintenanceMargin = (entryNotional: bigint, params: MarketParams) =>
  (entryNotional * params.maintenanceBps) / BPS;

/** `MarginAccount.equity`: collateral + PnL − funding, with the gain capped at the entry notional. May be negative. */
export const equity = (p: Position, price: bigint, owed: bigint) => {
  if (p.size === 0n) return 0n;
  let gain = pnl(p, price) - owed;
  if (gain > p.entryNotional) gain = p.entryNotional;
  return p.collateral + gain;
};

/** True when the PnL minus funding has reached the cap, so a higher price no longer adds profit. */
export const isGainCapped = (p: Position, price: bigint, owed: bigint) =>
  p.size !== 0n && pnl(p, price) - owed > p.entryNotional;

/** `MarginAccount.isLiquidatable`: equity under the maintenance margin. */
export const isLiquidatable = (p: Position, price: bigint, owed: bigint, params: MarketParams) =>
  p.size !== 0n && equity(p, price, owed) < maintenanceMargin(p.entryNotional, params);

/**
 * `MarginAccount.liquidationPrice`: the price at which the position becomes liquidatable, at the given funding.
 * 0 means none (a long whose collateral covers a fall to zero).
 */
export const liquidationPrice = (
  p: Pick<Position, "size" | "collateral" | "entryPrice" | "entryNotional">,
  owed: bigint,
  params: MarketParams,
) => {
  if (p.size === 0n) return 0n;
  const buffer = p.collateral - owed - maintenanceMargin(p.entryNotional, params);
  const liq = p.entryPrice - (buffer * USDC_PER_SIZE_PRICE) / p.size;
  return liq > 0n ? liq : 0n;
};

/**
 * How far the price can move against the position before it liquidates, in basis points of `price`.
 * Negative when it is already past the line. Undefined for a long with no liquidation price.
 */
export const distanceToLiquidationBps = (isLong: boolean, price: bigint, liq: bigint) => {
  if (price === 0n) return undefined;
  if (isLong && liq === 0n) return undefined;
  return ((isLong ? price - liq : liq - price) * BPS) / price;
};

/** `PerpMarket.close`: the close fee and what the trader receives. */
export const previewClose = (p: Position, price: bigint, owed: bigint, params: MarketParams) => {
  const eq = equity(p, price, owed);
  const fee = (p.entryNotional * params.closeFeeBps) / BPS;
  const payout = eq > fee ? eq - fee : 0n;
  return { equity: eq, pnl: pnl(p, price), funding: owed, fee, payout };
};

/**
 * `PerpMarket.closePrice`: the price a close settles at. Chainlink when the guard is `Ok`; otherwise whichever feed
 * is worse for the trader (lower for a long, higher for a short), or the one that still answers; 0 if neither does.
 * Prices are 1e18 (`PriceGuard.prices()`); status 0 = Ok, 1 = Stale, 2 = Deviated.
 * Markets deployed before this rule settle at Chainlink's last price whatever the status.
 */
export const closePrice = (isLong: boolean, chainlinkPrice: bigint, supraPrice: bigint, status: number) => {
  if (status === 0) return chainlinkPrice;
  if (chainlinkPrice === 0n) return supraPrice;
  if (supraPrice === 0n) return chainlinkPrice;
  if (isLong) return chainlinkPrice < supraPrice ? chainlinkPrice : supraPrice;
  return chainlinkPrice > supraPrice ? chainlinkPrice : supraPrice;
};

/** `PerpMarket.close` reverts with `PerpMarket__HoldTime(closeableAt)` before this unix time. */
export const closeableAt = (p: Pick<Position, "openedAt">, params: MarketParams) => p.openedAt + params.minHoldSeconds;

/**
 * The whole-number leverage the position was opened at, if collateral hasn't changed since. `_open` stores
 * `collateral − fee` with `notional = collateral × leverage`, so the leverage is the L for which that holds exactly.
 * Undefined after `addCollateral` (or never matched), when only the effective leverage means anything.
 */
export const openedLeverage = (p: Position, params: MarketParams) => {
  if (p.size === 0n) return undefined;
  const fee = (p.entryNotional * params.openFeeBps) / BPS;
  for (let l = 1n; l <= params.maxLeverage; l++) {
    if (p.entryNotional % l === 0n && p.entryNotional / l - fee === p.collateral) return l;
  }
  return undefined;
};

/*//////////////////////////////////////////////////////////////
                              OPEN
//////////////////////////////////////////////////////////////*/

export type OpenBlocker =
  /** `PerpMarket__ZeroAmount` */
  | "zero"
  /** `PerpMarket__BelowMinCollateral(minCollateral)` (markets with a `minCollateral` floor) */
  | "belowMin"
  /** `PerpMarket__InvalidLeverage`: leverage outside 1..max, or a fee as large as the collateral */
  | "leverage"
  /** `PerpMarket__OpenInterestCap(cap)` */
  | "cap";

export type OpenPreview = {
  notional: bigint;
  fee: bigint;
  /** Collateral the position keeps after the fee. */
  collateral: bigint;
  size: bigint;
  entryPrice: bigint;
  maintenance: bigint;
  liquidationPrice: bigint;
  /** 50% of the pool's USDC. */
  cap: bigint;
  /** Notional the market can still accept. */
  capRoom: bigint;
  /** Most collateral that fits under the cap at this leverage. */
  maxCollateral: bigint;
  /** Why the contract would revert (checked in the contract's order), or undefined. */
  blocker?: OpenBlocker;
};

/**
 * `PerpMarket._open`, as a preview. `price` is `PriceGuard.price()`; the real entry is whatever it is when the
 * transaction runs. `poolBalance` is the pool's USDC balance (`usdc.balanceOf(pool)`), `openInterest` is
 * `totalOpenNotional()`. Collateral is pulled into the market (not the pool) before the cap check, so it doesn't
 * change the cap. `minCollateral` is the market's floor (`PerpMarket.minCollateral()`); leave it out for a
 * market deployed before the floor existed.
 */
export const previewOpen = ({
  isLong,
  collateral,
  leverage,
  price,
  poolBalance,
  openInterest,
  params,
  minCollateral,
}: {
  isLong: boolean;
  collateral: bigint;
  leverage: bigint;
  price: bigint;
  poolBalance: bigint;
  openInterest: bigint;
  params: MarketParams;
  minCollateral?: bigint;
}): OpenPreview => {
  const notional = collateral * leverage;
  const cap = (poolBalance * params.maxOpenInterestBps) / BPS;
  const capRoom = cap > openInterest ? cap - openInterest : 0n;
  const maxCollateral = leverage > 0n ? capRoom / leverage : 0n;
  const fee = (notional * params.openFeeBps) / BPS;

  let blocker: OpenBlocker | undefined;
  // `open` checks zero first, then `_open` runs: floor, leverage, (one position per trader), cap, fee.
  if (collateral === 0n) blocker = "zero";
  else if (minCollateral !== undefined && collateral < minCollateral) blocker = "belowMin";
  else if (leverage === 0n || leverage > params.maxLeverage) blocker = "leverage";
  else if (openInterest + notional > cap) blocker = "cap";
  else if (fee >= collateral) blocker = "leverage";

  const valid = price > 0n && collateral > fee;
  const absSize = price > 0n ? (notional * USDC_PER_SIZE_PRICE) / price : 0n;
  const size = isLong ? absSize : -absSize;
  const kept = valid ? collateral - fee : 0n;
  const maintenance = maintenanceMargin(notional, params);
  const liq =
    valid && size !== 0n
      ? liquidationPrice({ size, collateral: kept, entryPrice: price, entryNotional: notional }, 0n, params)
      : 0n;

  return {
    notional,
    fee,
    collateral: kept,
    size,
    entryPrice: price,
    maintenance,
    liquidationPrice: liq,
    cap,
    capRoom,
    maxCollateral,
    blocker,
  };
};

/*//////////////////////////////////////////////////////////////
                             FUNDING
//////////////////////////////////////////////////////////////*/

/**
 * `MarginAccount._pendingFunding` rate: FUNDING_FACTOR_PER_HOUR × (long − short) / pool assets, 1e18 = 100% an hour.
 * Positive: longs pay shorts. Negative: shorts pay longs. 0 with an empty pool.
 */
export const fundingRatePerHour = (
  longNotional: bigint,
  shortNotional: bigint,
  poolAssets: bigint,
  params: MarketParams,
) => (poolAssets === 0n ? 0n : (params.fundingFactorPerHour * (longNotional - shortNotional)) / poolAssets);

/** `MarginAccount._pendingFunding` index after `dt` seconds. */
export const pendingFundingIndex = (
  index: bigint,
  longNotional: bigint,
  shortNotional: bigint,
  poolAssets: bigint,
  dt: bigint,
  params: MarketParams,
) =>
  poolAssets === 0n
    ? index
    : index + (params.fundingFactorPerHour * (longNotional - shortNotional) * dt) / (poolAssets * SECONDS_PER_HOUR);

/*//////////////////////////////////////////////////////////////
                          HBAR (SAUCERSWAP)
//////////////////////////////////////////////////////////////*/

/** HBAR has 8 decimals on Hedera (tinybars); the JSON-RPC relay takes `value` in 18 decimals (weibars). */
export const WEIBARS_PER_TINYBAR = 10n ** 10n;

/** `minCollateral` for `openWithHbar`: the quote less the slippage the trader accepts. */
export const minOutAfterSlippage = (quote: bigint, slippageBps: bigint) => (quote * (BPS - slippageBps)) / BPS;
