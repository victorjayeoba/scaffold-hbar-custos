"use client";

import { useId, useMemo, useState } from "react";
import { fmtBps, fmtHbar, fmtPrice, fmtRate, fmtSize, fmtUsdc, parseAmount } from "../_lib/format";
import { explainGuard } from "./MarketHeader";
import { type Step, Steps } from "./Steps";
import { useDebounceValue } from "usehooks-ts";
import { Address } from "viem";
import { useBalance, useGasPrice } from "wagmi";
import { POLL } from "~~/hooks/custos/poll";
import type { HtsToken } from "~~/hooks/custos/useHtsToken";
import { humanizeTradeError, useTradeAction } from "~~/hooks/custos/useTradeAction";
import type { TradeMarket } from "~~/hooks/custos/useTradeMarket";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import {
  BPS,
  CONTRACT_DEFAULTS,
  WEIBARS_PER_TINYBAR,
  fundingRatePerHour,
  minOutAfterSlippage,
  previewOpen,
} from "~~/utils/custos/perpMath";

type PayWith = "USDC" | "HBAR";

const LEVERAGE_PRESETS = [2, 5, 10, 25, 50];
const SLIPPAGE_OPTIONS = [50n, 100n, 200n]; // bps
/** The gas the repo's own scripts send `openWithHbar` with; used to keep enough HBAR back for the fee. */
const OPEN_WITH_HBAR_GAS = 3_000_000n;

/** Where to get the market's collateral token on testnet. */
const getUsdcHelp = (tokenId?: string) =>
  tokenId === "0.0.429274"
    ? { href: "https://faucet.circle.com/", label: "Circle's USDC faucet" }
    : { href: "https://testnet.saucerswap.finance/swap", label: "SaucerSwap testnet" };

export const TradeOpenForm = ({
  market,
  usdc,
  account,
  hasPosition,
  connectButton,
  now,
}: {
  now?: number;
  market: TradeMarket;
  usdc: HtsToken;
  account?: Address;
  hasPosition?: boolean;
  connectButton: React.ReactNode;
}) => {
  const ids = { amount: useId(), leverage: useId(), leverageNumber: useId(), slippage: useId() };
  const { targetNetwork } = useTargetNetwork();
  const action = useTradeAction();

  const [isLong, setIsLong] = useState(true);
  const [payWith, setPayWith] = useState<PayWith>("USDC");
  const [amountText, setAmountText] = useState("");
  const [leverage, setLeverage] = useState(10);
  const [slippageBps, setSlippageBps] = useState(100n);
  const [tokenError, setTokenError] = useState<string>();

  const params = market.params ?? CONTRACT_DEFAULTS;
  const maxLeverage = Number(params.maxLeverage);
  const decimals = payWith === "USDC" ? (usdc.decimals ?? 6) : 8;
  const parsed = parseAmount(amountText, decimals);
  const amount = parsed.value;

  // HBAR path: tinybars in, SaucerSwap quote out.
  const [debouncedTinybars] = useDebounceValue(payWith === "HBAR" ? (amount ?? 0n) : 0n, 400);
  const quoteRead = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "quoteHbarToUsdc",
    args: [debouncedTinybars],
    ...POLL,
    query: { ...POLL.query, enabled: payWith === "HBAR" && debouncedTinybars > 0n && market.swapEnabled === true },
  });
  const quoteIsCurrent = payWith === "HBAR" && amount !== undefined && amount === debouncedTinybars;
  const quote = quoteIsCurrent ? quoteRead.data : undefined;

  const { data: hbarBalance } = useBalance({
    address: account,
    chainId: targetNetwork.id,
    query: { enabled: !!account, ...POLL.query },
  });
  const { data: gasPrice } = useGasPrice({ chainId: targetNetwork.id, query: { refetchInterval: 60_000 } });
  const hbarFeeReserve = gasPrice ? gasPrice * OPEN_WITH_HBAR_GAS : undefined; // weibars

  // Collateral the contract will see: typed USDC, or the swap output.
  const collateral = payWith === "USDC" ? amount : quote;
  const minCollateral = quote !== undefined ? minOutAfterSlippage(quote, slippageBps) : undefined;

  const price = market.guard?.price ?? 0n;
  const preview = useMemo(
    () =>
      collateral !== undefined && market.poolBalance !== undefined && market.openInterest !== undefined && price > 0n
        ? previewOpen({
            isLong,
            collateral,
            leverage: BigInt(leverage),
            price,
            poolBalance: market.poolBalance,
            openInterest: market.openInterest,
            params,
            minCollateral: market.minCollateral,
          })
        : undefined,
    [collateral, leverage, isLong, price, market.poolBalance, market.openInterest, params, market.minCollateral],
  );

  // Funding after this position joins its side (the fee lands in the pool first).
  const fundingAfter =
    preview &&
    market.longNotional !== undefined &&
    market.shortNotional !== undefined &&
    market.poolBalance !== undefined
      ? fundingRatePerHour(
          market.longNotional + (isLong ? preview.notional : 0n),
          market.shortNotional + (isLong ? 0n : preview.notional),
          market.poolBalance + preview.fee,
          params,
        )
      : undefined;

  // Most the trader can put in at this leverage: the cap's room, and their balance.
  const capMax =
    market.poolBalance !== undefined && market.openInterest !== undefined
      ? (() => {
          const cap = (market.poolBalance * params.maxOpenInterestBps) / BPS;
          return cap > market.openInterest ? (cap - market.openInterest) / BigInt(leverage) : 0n;
        })()
      : undefined;

  const valueWeibars = payWith === "HBAR" && amount !== undefined ? amount * WEIBARS_PER_TINYBAR : undefined;

  // ---- What stops the open, in the order the trader should fix it ----
  const guardOk = market.guard?.status === "ok";
  const verdict = explainGuard(market, now);
  let blocker: string | undefined;
  if (!market.guard || !market.params) blocker = "Reading the market…";
  else if (!guardOk) blocker = verdict?.body ?? "The market is close-only right now.";
  else if (hasPosition) blocker = "You already have an open position. Each account holds one; manage it on the right.";
  else if (capMax === 0n)
    blocker =
      "The market is full: open positions already use the most the pool allows (half its USDC). New positions open again when someone closes or the pool grows.";
  else if (parsed.error) blocker = parsed.error;
  else if (amount === undefined || amount === 0n) blocker = "Enter an amount.";
  else if (payWith === "HBAR" && market.swapEnabled === false)
    blocker = "This market has no SaucerSwap router, so it can't take HBAR. Pay with USDC.";
  else if (payWith === "HBAR" && quoteRead.error && quoteIsCurrent)
    blocker = humanizeTradeError(quoteRead.error, targetNetwork.id, "SaucerSwap couldn't quote this amount.");
  else if (payWith === "HBAR" && quote === undefined) blocker = "Getting a SaucerSwap quote…";
  else if (preview?.blocker === "cap")
    blocker = `That's more than the market can take. At ${leverage}x you can put in up to ${fmtUsdc(
      preview.maxCollateral,
    )} USDC of collateral (open positions may use at most half the pool).`;
  else if (preview?.blocker === "leverage") blocker = `Leverage must be a whole number from 1x to ${maxLeverage}x.`;
  else if (preview?.blocker === "zero") blocker = "That's too little HBAR to swap into any USDC.";
  else if (preview?.blocker === "belowMin")
    blocker = `Positions need at least ${fmtUsdc(market.minCollateral, 2)} USDC of collateral${
      payWith === "HBAR" ? " after the swap" : ""
    }.`;
  else if (account && payWith === "USDC" && usdc.balance !== undefined && amount > usdc.balance)
    blocker = `You have ${fmtUsdc(usdc.balance, 6)} ${usdc.symbol ?? "USDC"}.`;
  else if (account && payWith === "HBAR" && hbarBalance && valueWeibars !== undefined) {
    const need = valueWeibars + (hbarFeeReserve ?? 0n);
    if (need > hbarBalance.value)
      blocker = `You have ${fmtHbar(hbarBalance.value)} HBAR; keep about ${fmtHbar(
        hbarFeeReserve ?? 0n,
        18,
        2,
      )} HBAR back for the network fee.`;
  }

  // ---- Wallet steps ----
  const association = usdc.association;
  const mustAssociate = association === "not-associated";
  const needsApproval =
    payWith === "USDC" &&
    amount !== undefined &&
    amount > 0n &&
    (usdc.allowance === undefined || usdc.allowance < amount);

  const steps: Step[] = [];
  if (account) {
    steps.push({
      label: `Associate ${usdc.symbol ?? "USDC"}`,
      state:
        association === "loading"
          ? "loading"
          : association === "associated" || association === "auto" || association === "not-required"
            ? "done"
            : "todo",
      note:
        payWith === "HBAR"
          ? "So the market can pay you in USDC when you close."
          : association === "auto"
            ? "Your account associates automatically."
            : undefined,
    });
    if (payWith === "USDC") steps.push({ label: "Approve", state: needsApproval ? "todo" : amount ? "done" : "todo" });
    steps.push({ label: payWith === "HBAR" ? "Swap and open" : "Open", state: "todo" });
  }

  const busy = !!action.pending || usdc.isApproving || usdc.isAssociating;
  const sideWord = isLong ? "long" : "short";

  const doAssociate = async () => {
    setTokenError(undefined);
    try {
      await usdc.associate();
    } catch (e) {
      setTokenError(humanizeTradeError(e, targetNetwork.id));
    }
  };
  const doApprove = async () => {
    if (!amount) return;
    setTokenError(undefined);
    try {
      await usdc.approve(amount);
    } catch (e) {
      setTokenError(humanizeTradeError(e, targetNetwork.id));
    }
  };
  const doOpen = async () => {
    if (!amount) return;
    const ok =
      payWith === "USDC"
        ? await action.run(
            { functionName: "open", args: [isLong, amount, BigInt(leverage)] },
            "The market couldn't take your USDC. Check your balance, approval and association.",
          )
        : minCollateral !== undefined && valueWeibars !== undefined
          ? await action.run(
              { functionName: "openWithHbar", args: [isLong, BigInt(leverage), minCollateral], value: valueWeibars },
              "The swap or the open failed. Get a fresh quote and try again.",
            )
          : false;
    if (ok) setAmountText("");
  };

  const setMax = () => {
    if (payWith === "USDC" && usdc.balance !== undefined) {
      const max = capMax !== undefined && capMax < usdc.balance ? capMax : usdc.balance;
      setAmountText(fmtUsdc(max, 6).replace(/,/g, ""));
    } else if (payWith === "HBAR" && hbarBalance) {
      const spendable = hbarBalance.value - (hbarFeeReserve ?? 0n);
      const tinybars = spendable > 0n ? spendable / WEIBARS_PER_TINYBAR : 0n;
      setAmountText(fmtHbar(tinybars, 8, 8).replace(/,/g, ""));
    }
  };

  const usdcHelp = getUsdcHelp(usdc.tokenId);
  const saucerPrice = payWith === "HBAR" && quote !== undefined && amount ? (quote * 10n ** 20n) / amount : undefined; // USD/HBAR, 1e18
  const saucerGapBps = saucerPrice && price > 0n ? ((saucerPrice - price) * BPS) / price : undefined;

  return (
    <section aria-labelledby="open-heading" className="rounded-box border border-base-300 bg-base-100 p-5 sm:p-6">
      <h2 id="open-heading" className="m-0 text-2xl font-normal">
        Open a position
      </h2>

      <form
        className="mt-5 space-y-5"
        onSubmit={e => {
          e.preventDefault();
          if (!blocker && !mustAssociate && !needsApproval) doOpen();
        }}
      >
        {/* Side */}
        <fieldset>
          <legend className="sr-only">Direction</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {[
              { long: true, label: "Long", note: "Profit if HBAR rises" },
              { long: false, label: "Short", note: "Profit if HBAR falls" },
            ].map(o => (
              <label
                key={o.label}
                className={`cursor-pointer rounded-box border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                  isLong === o.long
                    ? o.long
                      ? "border-success bg-success/15"
                      : "border-error bg-error/15"
                    : "border-base-300 hover:border-base-content/40"
                }`}
              >
                <input
                  type="radio"
                  name="side"
                  className="sr-only"
                  checked={isLong === o.long}
                  onChange={() => setIsLong(o.long)}
                />
                <span className="block text-lg">{o.label}</span>
                <span className="block text-xs text-base-content/60">{o.note}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Pay with */}
        <fieldset>
          <legend className="mb-2 text-sm text-base-content/70">Pay with</legend>
          <div className="join" role="radiogroup">
            {(["USDC", "HBAR"] as PayWith[]).map(p => (
              <label
                key={p}
                className={`btn join-item btn-sm shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                  payWith === p ? "btn-primary" : "btn-ghost border-base-300"
                } ${p === "HBAR" && market.swapEnabled === false ? "btn-disabled" : ""}`}
              >
                <input
                  type="radio"
                  name="payWith"
                  className="sr-only"
                  checked={payWith === p}
                  disabled={p === "HBAR" && market.swapEnabled === false}
                  onChange={() => {
                    setPayWith(p);
                    setAmountText("");
                  }}
                />
                {p === "USDC" ? (usdc.symbol ?? "USDC") : "HBAR via SaucerSwap"}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Amount */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={ids.amount} className="text-sm text-base-content/70">
              {payWith === "USDC" ? "Collateral" : "HBAR to swap into collateral"}
            </label>
            {account && (
              <span className="text-xs text-base-content/60">
                Balance{" "}
                {payWith === "USDC"
                  ? `${fmtUsdc(usdc.balance, 2)} ${usdc.symbol ?? "USDC"}`
                  : `${fmtHbar(hbarBalance?.value, 18, 2)} HBAR`}{" "}
                <button type="button" className="link link-primary" onClick={setMax}>
                  Max
                </button>
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center rounded-field border border-base-300 bg-base-200 px-4 focus-within:border-primary">
            <input
              id={ids.amount}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="w-full min-w-0 bg-transparent py-2.5 text-lg tabular-nums outline-none"
              value={amountText}
              onChange={e => setAmountText(e.target.value.replace(",", "."))}
              aria-invalid={!!parsed.error}
              aria-describedby={`${ids.amount}-help`}
            />
            <span className="shrink-0 text-base-content/60">
              {payWith === "USDC" ? (usdc.symbol ?? "USDC") : "HBAR"}
            </span>
          </div>
          <p id={`${ids.amount}-help`} className="mt-1 mb-0 text-xs text-base-content/60">
            {payWith === "USDC" ? (
              <>
                The opening fee comes out of this. Need {usdc.symbol ?? "USDC"}? Swap some HBAR on{" "}
                <a className="link" href={usdcHelp.href} target="_blank" rel="noreferrer">
                  {usdcHelp.label}
                </a>
                , or pay with HBAR.
              </>
            ) : quote !== undefined ? (
              <>
                SaucerSwap gives about {fmtUsdc(quote, 4)} USDC, at least {fmtUsdc(minCollateral, 4)} after{" "}
                {fmtBps(slippageBps, 1)} slippage. If it would give less, nothing happens.
              </>
            ) : (
              "The market swaps it to USDC on SaucerSwap in the same transaction, then opens."
            )}
          </p>
          {saucerGapBps !== undefined && (saucerGapBps > 500n || saucerGapBps < -500n) && (
            <p className="mt-1 mb-0 text-xs text-warning-content dark:text-warning">
              SaucerSwap&apos;s testnet pool prices HBAR at ${fmtPrice(saucerPrice)},{" "}
              {fmtBps(saucerGapBps < 0n ? -saucerGapBps : saucerGapBps, 0)} {saucerGapBps > 0n ? "above" : "below"}{" "}
              Chainlink. Testnet pools are thin; on mainnet the two track closely.
            </p>
          )}
        </div>

        {payWith === "HBAR" && (
          <fieldset>
            <legend id={ids.slippage} className="mb-2 text-sm text-base-content/70">
              Slippage you accept
            </legend>
            <div className="join" role="radiogroup" aria-labelledby={ids.slippage}>
              {SLIPPAGE_OPTIONS.map(s => (
                <label
                  key={s.toString()}
                  className={`btn join-item btn-sm shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                    slippageBps === s ? "btn-primary" : "btn-ghost border-base-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="slippage"
                    className="sr-only"
                    checked={slippageBps === s}
                    onChange={() => setSlippageBps(s)}
                  />
                  {fmtBps(s, 1)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {/* Leverage */}
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={ids.leverage} className="text-sm text-base-content/70">
              Leverage
            </label>
            <span className="flex items-baseline gap-1">
              <label htmlFor={ids.leverageNumber} className="sr-only">
                Leverage, exact
              </label>
              <input
                id={ids.leverageNumber}
                type="number"
                min={1}
                max={maxLeverage}
                step={1}
                value={leverage}
                onChange={e => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) setLeverage(Math.min(maxLeverage, Math.max(1, v)));
                }}
                className="w-14 rounded border border-base-300 bg-base-200 px-1 text-right text-lg tabular-nums"
              />
              <span className="text-lg">x</span>
            </span>
          </div>
          <input
            id={ids.leverage}
            type="range"
            min={1}
            max={maxLeverage}
            step={1}
            value={leverage}
            onChange={e => setLeverage(Number(e.target.value))}
            className="range range-primary range-sm mt-2 w-full"
            aria-valuetext={`${leverage} times`}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LEVERAGE_PRESETS.filter(l => l <= maxLeverage).map(l => (
              <button
                key={l}
                type="button"
                className={`btn btn-xs shadow-none ${leverage === l ? "btn-primary" : "btn-ghost border-base-300"}`}
                onClick={() => setLeverage(l)}
                aria-pressed={leverage === l}
              >
                {l}x
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <OpenPreviewList
          isLong={isLong}
          preview={preview}
          price={price}
          params={params}
          fundingAfter={fundingAfter}
          capMax={capMax}
          leverage={leverage}
          estimated={payWith === "HBAR"}
        />

        {/* Action */}
        <div className="space-y-3">
          {!account ? (
            <>
              {blocker && blocker !== "Enter an amount." && (
                <p className="m-0 text-sm text-base-content/80" role="status">
                  {blocker}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {connectButton}
                <span className="text-sm text-base-content/60">
                  Connect a wallet to open. The preview works without one.
                </span>
              </div>
            </>
          ) : (
            <>
              <Steps steps={steps} />
              {association === "no-account" && (
                <p className="m-0 text-sm text-warning-content dark:text-warning">
                  This address has no Hedera account yet. Send it some testnet HBAR first (the faucet link is in the
                  footer); that creates the account.
                </p>
              )}
              {association === "unknown" && (
                <p className="m-0 text-sm text-base-content/70">
                  Couldn&apos;t check your {usdc.symbol ?? "USDC"} association (the mirror node didn&apos;t answer). If
                  the open fails, associate first.
                </p>
              )}
              {blocker && (
                <p className="m-0 text-sm text-base-content/80" role="status">
                  {blocker}
                </p>
              )}
              {mustAssociate ? (
                <button
                  type="button"
                  className="btn btn-primary w-full rounded-full"
                  disabled={busy}
                  onClick={doAssociate}
                >
                  {usdc.isAssociating && <span className="loading loading-spinner loading-sm" />}
                  Associate {usdc.symbol ?? "USDC"} with your account
                </button>
              ) : needsApproval && !blocker ? (
                <button
                  type="button"
                  className="btn btn-primary w-full rounded-full"
                  disabled={busy}
                  onClick={doApprove}
                >
                  {usdc.isApproving && <span className="loading loading-spinner loading-sm" />}
                  Approve {fmtUsdc(amount, 6)} {usdc.symbol ?? "USDC"}
                </button>
              ) : (
                <button
                  type="submit"
                  className={`btn w-full rounded-full border-0 ${isLong ? "btn-success" : "btn-error"}`}
                  disabled={busy || !!blocker}
                >
                  {action.pending && <span className="loading loading-spinner loading-sm" />}
                  {payWith === "HBAR" ? `Swap and open ${sideWord} ${leverage}x` : `Open ${sideWord} ${leverage}x`}
                </button>
              )}
              {(action.error || tokenError) && (
                <p className="m-0 rounded-box bg-error/10 px-4 py-3 text-sm" role="alert">
                  {action.error ?? tokenError}
                </p>
              )}
            </>
          )}
        </div>
      </form>
    </section>
  );
};

const OpenPreviewList = ({
  isLong,
  preview,
  price,
  params,
  fundingAfter,
  capMax,
  leverage,
  estimated,
}: {
  isLong: boolean;
  preview?: ReturnType<typeof previewOpen>;
  price: bigint;
  params: NonNullable<TradeMarket["params"]>;
  fundingAfter?: bigint;
  capMax?: bigint;
  leverage: number;
  estimated: boolean;
}) => {
  const liqMoveBps =
    preview && preview.liquidationPrice > 0n && price > 0n
      ? ((isLong ? price - preview.liquidationPrice : preview.liquidationPrice - price) * BPS) / price
      : undefined;
  const closeFee = preview ? (preview.notional * params.closeFeeBps) / BPS : undefined;
  const pays = fundingAfter === undefined ? undefined : fundingAfter === 0n ? 0 : fundingAfter > 0n ? 1 : -1;
  const youPay = pays === 0 ? false : isLong ? pays === 1 : pays === -1;

  const rows: { label: string; value: React.ReactNode; note?: string }[] = [
    {
      label: "Size",
      value: preview ? `${fmtSize(preview.size)} HBAR ${isLong ? "long" : "short"}` : "—",
      note: preview ? `${fmtUsdc(preview.notional)} USDC notional` : undefined,
    },
    {
      label: "Entry price",
      value: price > 0n ? `≈ ${fmtPrice(price)}` : "—",
      note: "Chainlink's price when your transaction runs",
    },
    {
      label: `Opening fee (${fmtBps(params.openFeeBps)})`,
      value: preview ? `${fmtUsdc(preview.fee, 4)} USDC` : "—",
      note: preview ? `${fmtUsdc(preview.collateral, 4)} USDC stays as collateral` : undefined,
    },
    {
      label: "Liquidation price",
      value: preview ? (preview.liquidationPrice > 0n ? fmtPrice(preview.liquidationPrice) : "None") : "—",
      note:
        liqMoveBps !== undefined
          ? `A ${fmtBps(liqMoveBps)} move ${isLong ? "down" : "up"}, before funding`
          : preview && isLong
            ? "Collateral covers a fall to zero"
            : undefined,
    },
    {
      label: `Maintenance margin (${fmtBps(params.maintenanceBps)})`,
      value: preview ? `${fmtUsdc(preview.maintenance, 4)} USDC` : "—",
      note: "Below this equity the network liquidates",
    },
    {
      label: `Closing fee later (${fmtBps(params.closeFeeBps)})`,
      value: closeFee !== undefined ? `${fmtUsdc(closeFee, 4)} USDC` : "—",
    },
    {
      label: "Funding after you open",
      value:
        fundingAfter === undefined
          ? "—"
          : fundingAfter === 0n
            ? "Balanced"
            : `${youPay ? "You pay" : "You earn"} ${fmtRate(fundingAfter < 0n ? -fundingAfter : fundingAfter)}/h`,
      note: "Of notional, while the skew lasts",
    },
    {
      label: "Room under the cap",
      value: capMax !== undefined ? `${fmtUsdc(capMax)} USDC at ${leverage}x` : "—",
      note: `Open interest may use ${fmtBps(params.maxOpenInterestBps, 0)} of the pool`,
    },
  ];

  return (
    <div>
      <h3 className="m-0 mb-2 text-sm font-normal text-base-content/70">
        Before you sign{estimated ? " (estimated from the SaucerSwap quote)" : ""}
      </h3>
      <dl className="m-0 divide-y divide-base-300 rounded-box border border-base-300 text-sm">
        {rows.map(r => (
          <div key={r.label} className="flex items-start justify-between gap-4 px-4 py-2">
            <dt className="text-base-content/70">{r.label}</dt>
            <dd className="m-0 text-right tabular-nums">
              {r.value}
              {r.note && <div className="text-xs text-base-content/55">{r.note}</div>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
