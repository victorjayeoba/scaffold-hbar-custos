"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { fmtBps, fmtDuration, fmtHbar, fmtPrice, fmtSignedUsdc, fmtSize, fmtUsdc, parseAmount } from "../_lib/format";
import { Skeleton } from "./MarketHeader";
import { Address } from "viem";
import { useAccount } from "wagmi";
import { POLL } from "~~/hooks/custos/poll";
import type { HtsToken } from "~~/hooks/custos/useHtsToken";
import { countdown } from "~~/hooks/custos/useNow";
import { humanizeTradeError, useTradeAction } from "~~/hooks/custos/useTradeAction";
import type { TradeMarket } from "~~/hooks/custos/useTradeMarket";
import { useTradePosition } from "~~/hooks/custos/useTradePosition";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import {
  CONTRACT_DEFAULTS,
  closeableAt,
  distanceToLiquidationBps,
  isGainCapped,
  isLiquidatable,
  liquidationPrice as liquidationPriceOf,
  maintenanceMargin,
  minOutAfterSlippage,
  openedLeverage,
  previewClose,
} from "~~/utils/custos/perpMath";

/**
 * Hedera's block.timestamp is the start of a ~2 s block, so a close sent the second the hold ends can still read as
 * early. Wait this long past `closeableAt` before enabling the button.
 */
const HOLD_TOLERANCE_SECONDS = 3;

/** What the trader can be paid in when closing. HBAR goes through `closeToHbar` (SaucerSwap). */
type Payout = "USDC" | "HBAR";
/** Slippage accepted on the USDC → HBAR swap of a close. */
const CLOSE_SLIPPAGE_BPS = 100n;

export const TradePositionCard = ({
  market,
  usdc,
  account,
  position: pos,
  now,
  connectButton,
}: {
  market: TradeMarket;
  usdc: HtsToken;
  account?: Address;
  position: ReturnType<typeof useTradePosition>;
  now?: number;
  connectButton: React.ReactNode;
}) => {
  const { targetNetwork } = useTargetNetwork();

  if (!account) {
    return (
      <Shell>
        <p className="mt-2 text-base-content/70">
          Connect a wallet to see your position, its liquidation price and the close countdown.
        </p>
        <div>{connectButton}</div>
      </Shell>
    );
  }
  if (pos.isLoading || !market.guard) {
    return (
      <Shell>
        <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading your position">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Shell>
    );
  }
  if (pos.error && !pos.position) {
    return (
      <Shell>
        <p className="mt-2 text-base-content/70" role="alert">
          {humanizeTradeError(pos.error, targetNetwork.id)} The page retries every 30 seconds.
        </p>
      </Shell>
    );
  }
  if (!pos.hasPosition || !pos.position) {
    return (
      <Shell>
        <p className="mt-2 text-base-content/70">
          No open position. Open one and it appears here with its liquidation price, profit and loss, and funding.
        </p>
        <p className="mb-0 text-sm text-base-content/60">
          Had one? It may have been liquidated by the network: check the activity on the{" "}
          <Link href="/keeper" className="link">
            Keeper page
          </Link>
          .
        </p>
      </Shell>
    );
  }

  return <OpenPosition market={market} usdc={usdc} pos={pos} now={now} />;
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <section aria-labelledby="position-heading" className="rounded-box border border-base-300 bg-base-100 p-5 sm:p-6">
    <h2 id="position-heading" className="m-0 text-2xl font-normal">
      Your position
    </h2>
    {children}
  </section>
);

const OpenPosition = ({
  market,
  usdc,
  pos,
  now,
}: {
  market: TradeMarket;
  usdc: HtsToken;
  pos: ReturnType<typeof useTradePosition>;
  now?: number;
}) => {
  const { targetNetwork } = useTargetNetwork();
  const { address: trader } = useAccount();
  const action = useTradeAction();
  const p = pos.position!;
  const params = market.params ?? CONTRACT_DEFAULTS;
  const g = market.guard!;
  const mark = g.price;
  const owed = pos.fundingOwed ?? 0n;
  const isLong = p.size > 0n;

  // The price a close settles at: Chainlink when prices are Ok, otherwise whichever feed is worse for the trader.
  const { data: contractClosePrice } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "closePrice",
    args: [trader],
    ...POLL,
  });
  const closePx = contractClosePrice ?? mark;
  const close = previewClose(p, closePx, owed, params);
  const mm = maintenanceMargin(p.entryNotional, params);
  // The contract's own number (at its current funding); perpMath gives the same if the read lags.
  const liq = pos.liquidationPrice ?? liquidationPriceOf(p, owed, params);
  const distance = distanceToLiquidationBps(isLong, mark, liq);
  const underwater = mark > 0n && isLiquidatable(p, mark, owed, params);
  const capped = mark > 0n && isGainCapped(p, mark, owed);
  const lev = openedLeverage(p, params);
  const effectiveLev = p.collateral > 0n ? Number((p.entryNotional * 100n) / p.collateral) / 100 : undefined;
  const pnlPct = p.collateral > 0n ? Number(((close.equity - p.collateral) * 10_000n) / p.collateral) / 100 : 0;

  // Margin left: 100% at equity = collateral, 0% at the maintenance line.
  const room = p.collateral - mm;
  const health = room > 0n ? Math.max(0, Math.min(100, Number(((close.equity - mm) * 100n) / room))) : 0;

  const closeAt = Number(closeableAt(p, params));
  const holdLeft = now !== undefined ? closeAt + HOLD_TOLERANCE_SECONDS - now : undefined;
  const holding = holdLeft === undefined || holdLeft > 0;

  const [payout, setPayout] = useState<Payout>("USDC");
  const toHbar = payout === "HBAR" && market.canCloseToHbar;
  // HBAR payout: SaucerSwap quote for the expected USDC payout, less slippage, as `minHbarOut`.
  const { data: hbarQuote } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "quoteUsdcToHbar",
    args: [close.payout],
    watch: false,
    query: { enabled: toHbar && close.payout > 0n, ...POLL.query },
  });
  const minHbarOut = hbarQuote !== undefined ? minOutAfterSlippage(hbarQuote, CLOSE_SLIPPAGE_BPS) : undefined;

  // A USDC close pays the trader in USDC, so they must be able to receive it (unless nothing is left to pay).
  // closeToHbar settles to the market and swaps, so it needs no association.
  const needsAssociation = !toHbar && close.payout > 0n && usdc.association === "not-associated";
  const waitingForQuote = toHbar && close.payout > 0n && minHbarOut === undefined;

  const doClose = () =>
    toHbar
      ? action.run(
          { functionName: "closeToHbar", args: [close.payout > 0n ? (minHbarOut ?? 0n) : 0n] },
          "The close or the swap to HBAR failed. Try again, or take USDC.",
        )
      : action.run({ functionName: "close" }, "The market couldn't close your position.");

  const [tokenError, setTokenError] = useState<string>();
  const busy = !!action.pending || usdc.isAssociating || usdc.isApproving;

  const rows: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: string }[] = [
    { label: "Entry price", value: fmtPrice(p.entryPrice) },
    { label: "Mark price", value: mark > 0n ? fmtPrice(mark) : "No price" },
    {
      label: "Size",
      value: `${fmtSize(p.size)} HBAR`,
      note: `${fmtUsdc(p.entryNotional)} USDC notional`,
    },
    {
      label: "Collateral",
      value: `${fmtUsdc(p.collateral, 4)} USDC`,
      note: lev
        ? `Opened at ${lev}x`
        : effectiveLev !== undefined
          ? `${effectiveLev.toFixed(2)}x of notional after added collateral`
          : undefined,
    },
    {
      label: "Profit / loss",
      value: mark > 0n ? `${fmtSignedUsdc(close.pnl, 4)} USDC` : "—",
      tone: close.pnl > 0n ? "text-success" : close.pnl < 0n ? "text-error" : undefined,
      note: "From the price move",
    },
    {
      label: "Funding",
      value: `${fmtSignedUsdc(-owed, 4)} USDC`,
      tone: owed > 0n ? "text-error" : owed < 0n ? "text-success" : undefined,
      note: owed > 0n ? "You owe this; it's taken when you close" : owed < 0n ? "Owed to you" : "Nothing yet",
    },
    {
      label: "Equity",
      value: `${fmtUsdc(close.equity, 4)} USDC`,
      note: `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% on collateral${capped ? " · gain capped at notional" : ""}`,
    },
    {
      label: "Liquidation price",
      value: liq > 0n ? fmtPrice(liq) : "None",
      note:
        distance !== undefined
          ? distance > 0n
            ? `${fmtBps(distance)} ${isLong ? "below" : "above"} the mark`
            : "Already past it"
          : "Collateral covers a fall to zero",
    },
    { label: `Maintenance margin (${fmtBps(params.maintenanceBps)})`, value: `${fmtUsdc(mm, 4)} USDC` },
  ];

  return (
    <Shell>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`rounded-full px-3 py-0.5 text-sm ${isLong ? "bg-success/20 text-success-content dark:text-success" : "bg-error/20 text-error-content dark:text-error"}`}
        >
          {isLong ? "LONG" : "SHORT"}
          {lev ? ` ${lev}x` : ""}
        </span>
        <span className="tabular-nums text-base-content/80">{fmtSize(p.size)} HBAR</span>
      </div>

      {/* Health */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-base-content/70">Margin left before liquidation</span>
          <span className="tabular-nums">{health.toFixed(0)}%</span>
        </div>
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-base-300"
          role="meter"
          aria-label="Margin left before liquidation"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(health)}
        >
          <div
            className={`h-full ${health > 50 ? "bg-success" : health > 20 ? "bg-warning" : "bg-error"}`}
            style={{ width: `${health}%` }}
          />
        </div>
      </div>

      {underwater && (
        <p className="mt-3 mb-0 rounded-box bg-error/15 px-4 py-3 text-sm" role="alert">
          {g.status === "ok"
            ? "This position is under its maintenance margin. The network liquidates it at its next check, and anyone may liquidate it before then. Add collateral now to keep it."
            : "This position is under its maintenance margin. Liquidations are paused while prices are bad, but it will be liquidated as soon as they recover unless you add collateral."}
        </p>
      )}

      <dl className="mt-4 mb-0 divide-y divide-base-300 rounded-box border border-base-300 text-sm">
        {rows.map(r => (
          <div key={r.label} className="flex items-start justify-between gap-4 px-4 py-2">
            <dt className="text-base-content/70">{r.label}</dt>
            <dd className={`m-0 text-right tabular-nums ${r.tone ?? ""}`}>
              {r.value}
              {r.note && <div className="text-xs text-base-content/55">{r.note}</div>}
            </dd>
          </div>
        ))}
      </dl>

      {/* Close */}
      <div className="mt-5 rounded-box bg-base-200 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0 text-base font-normal">Close now</h3>
          <span className="text-sm tabular-nums">
            You receive about{" "}
            {toHbar ? (
              <>
                <span className="text-lg">{hbarQuote !== undefined ? fmtHbar(hbarQuote, 8, 4) : "…"}</span> HBAR
              </>
            ) : (
              <>
                <span className="text-lg">{fmtUsdc(close.payout, 4)}</span> USDC
              </>
            )}
          </span>
        </div>
        <p className="mt-1 mb-3 text-xs text-base-content/60">
          Equity {fmtUsdc(close.equity, 4)} minus the {fmtBps(params.closeFeeBps)} closing fee ({fmtUsdc(close.fee, 4)}
          ), at {closePx > 0n ? fmtPrice(closePx) : "the price"}:{" "}
          {g.status === "ok"
            ? "Chainlink's price when the transaction runs."
            : "prices are bad right now, so the close settles at whichever feed is worse for you."}{" "}
          Closing works in close-only mode too.
          {toHbar && " SaucerSwap swaps the USDC to HBAR in the same transaction, accepting up to 1% slippage."}
        </p>

        {market.canCloseToHbar && (
          <fieldset className="mb-3">
            <legend className="mb-1 text-sm text-base-content/70">Receive</legend>
            <div className="join" role="radiogroup">
              {(
                [
                  { id: "USDC", label: usdc.symbol ?? "USDC" },
                  { id: "HBAR", label: "HBAR via SaucerSwap" },
                ] as const
              ).map(o => (
                <label
                  key={o.id}
                  className={`btn join-item btn-sm shadow-none ${payout === o.id ? "btn-primary" : "btn-ghost border-base-300"}`}
                >
                  <input
                    type="radio"
                    name="payout"
                    className="sr-only"
                    checked={payout === o.id}
                    onChange={() => setPayout(o.id)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {needsAssociation ? (
          <>
            <p className="mt-0 mb-2 text-sm">
              Associate {usdc.symbol ?? "USDC"} first so the market can pay you; otherwise the close fails.
            </p>
            <button
              type="button"
              className="btn btn-primary w-full rounded-full"
              disabled={busy}
              onClick={async () => {
                setTokenError(undefined);
                try {
                  await usdc.associate();
                } catch (e) {
                  setTokenError(humanizeTradeError(e, targetNetwork.id));
                }
              }}
            >
              {usdc.isAssociating && <span className="loading loading-spinner loading-sm" />}
              Associate {usdc.symbol ?? "USDC"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-neutral w-full rounded-full"
            disabled={busy || holding || closePx === 0n || waitingForQuote}
            onClick={doClose}
          >
            {(action.pending === "close" || action.pending === "closeToHbar") && (
              <span className="loading loading-spinner loading-sm" />
            )}
            {holding && holdLeft !== undefined
              ? `Close allowed in ${countdown(holdLeft)}`
              : closePx === 0n
                ? "Waiting for a price feed to answer"
                : waitingForQuote
                  ? "Getting a SaucerSwap quote…"
                  : toHbar
                    ? "Close and receive HBAR"
                    : "Close position"}
          </button>
        )}
        {holding && holdLeft !== undefined && (
          <p className="mt-2 mb-0 text-xs text-base-content/60">
            Positions stay open at least {fmtDuration(Number(params.minHoldSeconds))} (opened{" "}
            {new Date(Number(p.openedAt) * 1000).toLocaleTimeString()}).
          </p>
        )}
      </div>

      <AddCollateral
        usdc={usdc}
        position={p}
        owed={owed}
        params={params}
        mark={mark}
        busy={busy}
        onAdd={amount =>
          action.run(
            { functionName: "addCollateral", args: [amount] },
            "The market couldn't take your USDC. Check your balance, approval and association.",
          )
        }
        adding={action.pending === "addCollateral"}
        onTokenError={setTokenError}
      />

      {(action.error || tokenError) && (
        <p className="mt-3 mb-0 rounded-box bg-error/10 px-4 py-3 text-sm" role="alert">
          {action.error ?? tokenError}
        </p>
      )}
    </Shell>
  );
};

const AddCollateral = ({
  usdc,
  position,
  owed,
  params,
  mark,
  busy,
  adding,
  onAdd,
  onTokenError,
}: {
  usdc: HtsToken;
  position: NonNullable<ReturnType<typeof useTradePosition>["position"]>;
  owed: bigint;
  params: NonNullable<TradeMarket["params"]>;
  mark: bigint;
  busy: boolean;
  adding: boolean;
  onAdd: (amount: bigint) => Promise<boolean>;
  onTokenError: (message?: string) => void;
}) => {
  const id = useId();
  const { targetNetwork } = useTargetNetwork();
  const [text, setText] = useState("");
  const parsed = parseAmount(text, usdc.decimals ?? 6);
  const amount = parsed.value;
  const isLong = position.size > 0n;

  const newLiq =
    amount && amount > 0n
      ? liquidationPriceOf({ ...position, collateral: position.collateral + amount }, owed, params)
      : undefined;
  const newDistance = newLiq !== undefined ? distanceToLiquidationBps(isLong, mark, newLiq) : undefined;

  let blocker: string | undefined;
  if (parsed.error) blocker = parsed.error;
  else if (usdc.balance !== undefined && amount !== undefined && amount > usdc.balance)
    blocker = `You have ${fmtUsdc(usdc.balance, 6)} ${usdc.symbol ?? "USDC"}.`;
  const needsApproval = !!amount && (usdc.allowance === undefined || usdc.allowance < amount);

  return (
    <form
      className="mt-5"
      onSubmit={async e => {
        e.preventDefault();
        if (!amount || blocker) return;
        onTokenError(undefined);
        if (needsApproval) {
          try {
            await usdc.approve(amount);
          } catch (err) {
            onTokenError(humanizeTradeError(err, targetNetwork.id));
          }
          return;
        }
        if (await onAdd(amount)) setText("");
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-base">
          Add collateral
        </label>
        <span className="text-xs text-base-content/60">
          Balance {fmtUsdc(usdc.balance)} {usdc.symbol ?? "USDC"}
        </span>
      </div>
      <p className="mt-0.5 mb-2 text-xs text-base-content/60">
        Moves your liquidation price away. Allowed any time, even in close-only mode.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 items-center rounded-field border border-base-300 bg-base-200 px-4 focus-within:border-primary">
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="w-full min-w-0 bg-transparent py-2 tabular-nums outline-none"
            value={text}
            onChange={e => setText(e.target.value.replace(",", "."))}
            aria-invalid={!!blocker}
            aria-describedby={`${id}-help`}
          />
          <span className="text-base-content/60">{usdc.symbol ?? "USDC"}</span>
        </div>
        <button
          type="submit"
          className="btn btn-outline rounded-full"
          disabled={busy || !amount || !!blocker || usdc.association === "not-associated"}
        >
          {(adding || usdc.isApproving) && <span className="loading loading-spinner loading-sm" />}
          {needsApproval ? `Approve ${fmtUsdc(amount, 6)}` : "Add"}
        </button>
      </div>
      <p id={`${id}-help`} className="mt-1 mb-0 text-xs text-base-content/70" role="status">
        {blocker ??
          (newLiq !== undefined
            ? `New liquidation price ${newLiq > 0n ? fmtPrice(newLiq) : "none"}${
                newDistance !== undefined ? `, ${fmtBps(newDistance)} from the mark` : ""
              }.${needsApproval ? " Approve first, then add." : ""}`
            : " ")}
      </p>
    </form>
  );
};
