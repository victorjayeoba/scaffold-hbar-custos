"use client";

import { useId, useState } from "react";
import { PoolConnectGate } from "./PoolConnectGate";
import { PoolSteps, type Step } from "./PoolSteps";
import { useDebounceValue } from "usehooks-ts";
import { type Address, formatUnits } from "viem";
import { useBalance, useGasPrice } from "wagmi";
import { USDC_DECIMALS, amountProblem, fmt, fmtUsdc, parseAmount } from "~~/app/pool/_lib/format";
import { poolErrorMessage } from "~~/app/pool/_lib/poolErrors";
import { usePoolWrite } from "~~/app/pool/_lib/usePoolWrite";
import { POLL } from "~~/hooks/custos/poll";
import type { HtsToken } from "~~/hooks/custos/useHtsToken";
import type { PoolState } from "~~/hooks/custos/usePool";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { WEIBARS_PER_TINYBAR, minOutAfterSlippage } from "~~/utils/custos/perpMath";

const USDC_FAUCET = "https://faucet.circle.com/";
const HBAR_FAUCET = "https://portal.hedera.com/faucet";
const PREVIEW_DEBOUNCE_MS = 400;

type Tab = "deposit" | "withdraw";

/** Deposit and withdraw, as two tabs over one card. */
export const PoolActions = ({
  pool,
  owner,
  wrongNetwork,
}: {
  pool: PoolState;
  owner?: Address;
  wrongNetwork: boolean;
}) => {
  const [tab, setTab] = useState<Tab>("deposit");
  const id = useId();
  const tabs: { key: Tab; label: string }[] = [
    { key: "deposit", label: "Deposit" },
    { key: "withdraw", label: "Withdraw" },
  ];

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
      <div role="tablist" aria-label="Pool action" className="inline-flex rounded-full bg-base-200 p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${id}-${t.key}-tab`}
            aria-selected={tab === t.key}
            aria-controls={`${id}-${t.key}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={e => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const nextTab = tab === "deposit" ? "withdraw" : "deposit";
                setTab(nextTab);
                document.getElementById(`${id}-${nextTab}-tab`)?.focus();
              }
            }}
            className={`rounded-full px-5 py-1.5 text-sm transition-colors ${
              tab === t.key ? "bg-base-100 text-base-content shadow-sm" : "text-base-content/70 hover:text-base-content"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} className="mt-6">
        {!owner || wrongNetwork ? (
          <PoolConnectGate
            wrongNetwork={wrongNetwork}
            what={tab === "deposit" ? "to deposit USDC or HBAR into the pool" : "to withdraw from the pool"}
          />
        ) : tab === "deposit" ? (
          <DepositForm pool={pool} owner={owner} />
        ) : (
          <WithdrawForm pool={pool} owner={owner} />
        )}
      </div>
    </div>
  );
};

/** The label, input, unit and helper/error lines every amount field shares. */
const AmountField = ({
  id,
  label,
  value,
  onChange,
  unit,
  helper,
  problem,
  onMax,
  maxLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: React.ReactNode;
  helper?: React.ReactNode;
  problem?: string;
  onMax?: () => void;
  maxLabel?: string;
}) => (
  <div>
    <label htmlFor={id} className="mb-2 block text-sm">
      {label}
    </label>
    <div
      className={`flex items-center gap-2 rounded-full border bg-base-200 px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
        problem ? "border-error" : "border-base-300"
      }`}
    >
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        onChange={e => onChange(e.target.value.replace(",", "."))}
        aria-invalid={!!problem}
        aria-describedby={`${id}-help${problem ? ` ${id}-error` : ""}`}
        className="h-12 min-w-0 flex-1 bg-transparent text-lg tabular-nums outline-none"
      />
      {onMax && (
        <button type="button" onClick={onMax} className="btn btn-ghost btn-xs rounded-full" aria-label={maxLabel}>
          Max
        </button>
      )}
      <span className="shrink-0 text-sm text-base-content/70">{unit}</span>
    </div>
    <p id={`${id}-help`} className="mt-2 mb-0 text-sm text-base-content/70">
      {helper}
    </p>
    {problem && (
      <p id={`${id}-error`} className="mt-1 mb-0 text-sm text-red-700 dark:text-error" role="alert">
        {problem}
      </p>
    )}
  </div>
);

const ErrorBox = ({ error, ctx }: { error: unknown; ctx: Parameters<typeof poolErrorMessage>[1] }) =>
  error ? (
    <p role="alert" className="mt-4 mb-0 rounded-box bg-error/15 p-4 text-sm leading-relaxed">
      {poolErrorMessage(error, ctx)}
    </p>
  ) : null;

/** Steps to let `token` be received by the connected account. Empty when nothing is needed. */
const associateStep = (token: HtsToken, key: string, label: string): Step[] =>
  token.isHts && (token.association === "not-associated" || token.association === "unknown")
    ? [{ key, label, done: false, action: label, run: token.associate }]
    : [];

/** True when something outside the form stops every pool action. */
const blocked = (pool: PoolState) => pool.shares.notCreated || pool.paused || pool.usdc.association === "no-account";

/** Problems that stop every step, with a way out. */
const AccountBlocker = ({ pool }: { pool: PoolState }) =>
  pool.shares.notCreated ? (
    <p className="mt-4 mb-0 rounded-box bg-warning/15 p-4 text-sm leading-relaxed">
      The pool&apos;s cUSDC-LP share token hasn&apos;t been created yet, so it can&apos;t take deposits or pay out. The
      pool owner creates it once with <code className="text-xs">createShareToken()</code>.
    </p>
  ) : pool.paused ? (
    <p className="mt-4 mb-0 rounded-box bg-warning/15 p-4 text-sm leading-relaxed">
      Deposits and withdrawals are paused: Chainlink and Supra are stale or disagree while positions are open, so the
      pool can&apos;t price its shares fairly. They reopen as soon as the prices check out again.
    </p>
  ) : pool.usdc.association === "no-account" ? (
    <p className="mt-4 mb-0 rounded-box bg-warning/15 p-4 text-sm leading-relaxed">
      This address has no Hedera account yet. Send it some testnet HBAR from the{" "}
      <a className="link" href={HBAR_FAUCET} target="_blank" rel="noreferrer">
        Hedera Portal faucet
      </a>{" "}
      and Hedera creates one; then you can associate USDC.
    </p>
  ) : null;

type PayWith = "usdc" | "hbar";

const SLIPPAGE_OPTIONS = [50n, 100n, 200n]; // bps, as on /trade
/** Gas limit the live zap deposit was sent with (it used 1,049,204); Max keeps this much fee back. */
const DEPOSIT_WITH_HBAR_GAS = 1_400_000n;
const HBAR_DECIMALS = 8; // tinybars
const fmtHbar = (weibars?: bigint) => fmt(weibars, 18, 2, 2);

/** A row of pill radios, the same control as "Withdraw by". */
const PillChoice = <T extends string | bigint>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
}) => (
  <fieldset className="m-0 mb-4 border-0 p-0">
    <legend className="mb-2 text-sm">{legend}</legend>
    <div className="inline-flex flex-wrap rounded-full bg-base-200 p-1 text-sm">
      {options.map(([v, label]) => (
        <label
          key={String(v)}
          className={`cursor-pointer rounded-full px-4 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
            value === v ? "bg-base-100 shadow-sm" : "text-base-content/70"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={String(v)}
            checked={value === v}
            onChange={() => onChange(v)}
            className="sr-only"
          />
          {label}
        </label>
      ))}
    </div>
  </fieldset>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mt-1 flex items-baseline justify-between gap-4 first:mt-0">
    <span className="text-base-content/70">{label}</span>
    <span className="text-right tabular-nums">{children}</span>
  </div>
);

const DepositForm = ({ pool, owner }: { pool: PoolState; owner: Address }) => {
  const id = useId();
  const { usdc, shares } = pool;
  const { targetNetwork } = useTargetNetwork();
  const [payWith, setPayWith] = useState<PayWith>("usdc");
  const [slippageBps, setSlippageBps] = useState(100n);
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState<string>();
  const hbar = payWith === "hbar";
  const decimals = hbar ? HBAR_DECIMALS : USDC_DECIMALS;
  const amount = parseAmount(text, decimals);
  const [debounced] = useDebounceValue(amount, PREVIEW_DEBOUNCE_MS);
  const fresh = amount !== undefined && debounced === amount;
  const { deposit, depositWithHbar } = usePoolWrite(owner);

  // HBAR path: what SaucerSwap gives for the tinybars, and the least the zap lets it give (Chainlink value less 3%).
  const zapQuery = { ...POLL.query, enabled: hbar && debounced !== undefined };
  const quoteRead = useScaffoldReadContract({
    contractName: "HbarDepositZap",
    functionName: "quote",
    args: [hbar ? debounced : undefined],
    ...POLL,
    query: zapQuery,
  });
  const floorRead = useScaffoldReadContract({
    contractName: "HbarDepositZap",
    functionName: "oracleFloor",
    args: [hbar ? debounced : undefined],
    ...POLL,
    query: zapQuery,
  });
  const { data: bandBps } = useScaffoldReadContract({
    contractName: "HbarDepositZap",
    functionName: "maxSwapDeviationBps",
    watch: false, // immutable
  });
  const quote = hbar && fresh ? quoteRead.data : undefined;
  const floor = hbar && fresh ? floorRead.data : undefined;
  const minUsdc = quote !== undefined ? minOutAfterSlippage(quote, slippageBps) : undefined;
  // The zap raises the caller's minimum to the oracle floor, so this is what the swap must return.
  const mustGet = minUsdc !== undefined && floor !== undefined ? (floor > minUsdc ? floor : minUsdc) : undefined;
  const band = bandBps !== undefined ? `${Number(bandBps) / 100}%` : "its band";

  const { data: hbarBalance } = useBalance({
    address: owner,
    chainId: targetNetwork.id,
    query: { enabled: hbar, ...POLL.query },
  });
  const { data: gasPrice } = useGasPrice({ chainId: targetNetwork.id, query: { refetchInterval: 60_000 } });
  const feeReserve = gasPrice ? gasPrice * DEPOSIT_WITH_HBAR_GAS : undefined; // weibars
  const valueWeibars = hbar && amount !== undefined ? amount * WEIBARS_PER_TINYBAR : undefined;

  const { data: preview } = useScaffoldReadContract({
    contractName: "LiquidityPool",
    functionName: "previewDeposit",
    args: [hbar ? quote : debounced],
    ...POLL,
  });

  const overBalance = hbar
    ? valueWeibars !== undefined && hbarBalance !== undefined && valueWeibars + (feeReserve ?? 0n) > hbarBalance.value
    : amount !== undefined && usdc.balance !== undefined && amount > usdc.balance;
  // With no USDC or HBAR at all the helper line already says so (with the faucet link).
  const balanceProblem = !overBalance
    ? undefined
    : hbar
      ? hbarBalance!.value > 0n
        ? `You have ${fmtHbar(hbarBalance!.value)} HBAR; keep about ${fmtHbar(feeReserve ?? 0n)} HBAR back for the network fee.`
        : undefined
      : usdc.balance! > 0n
        ? `That's more than your ${fmtUsdc(usdc.balance)} USDC.`
        : undefined;
  const problem = amountProblem(text, decimals) ?? balanceProblem;

  // Why the zap can't take this amount right now (the price, or SaucerSwap), found before any wallet opens.
  const zapError = hbar && fresh ? (floorRead.error ?? quoteRead.error ?? undefined) : undefined;
  const belowFloor = quote !== undefined && floor !== undefined && quote < floor;
  const symbol = shares.symbol ?? "cUSDC-LP";

  const steps: Step[] = hbar
    ? [
        ...associateStep(shares, "assoc-shares", `Associate with ${symbol} so you can receive shares`),
        {
          key: "zap",
          label: "Swap on SaucerSwap and deposit",
          done: false,
          action: amount ? `Swap ${fmt(amount, HBAR_DECIMALS, 4)} HBAR and deposit` : "Swap and deposit",
          run: () => depositWithHbar(valueWeibars!, minUsdc!),
        },
      ]
    : [
        ...associateStep(usdc, "assoc-usdc", "Associate your account with USDC"),
        ...associateStep(shares, "assoc-shares", `Associate with ${symbol} so you can receive shares`),
        {
          key: "approve",
          label: amount ? `Let the pool take ${fmtUsdc(amount)} USDC` : "Let the pool take your USDC",
          done: amount !== undefined && usdc.allowance !== undefined && usdc.allowance >= amount,
          action: "Approve USDC",
          run: () => usdc.approve(amount!),
        },
        {
          key: "deposit",
          label: "Deposit",
          done: false,
          action: amount ? `Deposit ${fmtUsdc(amount)} USDC` : "Deposit",
          run: () => deposit(amount!),
        },
      ];

  const setMax = () => {
    if (!hbar) {
      if (usdc.balance) setText(formatUnits(usdc.balance, USDC_DECIMALS));
    } else if (hbarBalance) {
      const spendable = hbarBalance.value - (feeReserve ?? 0n);
      setText(formatUnits(spendable > 0n ? spendable / WEIBARS_PER_TINYBAR : 0n, HBAR_DECIMALS));
    }
  };

  // USD per HBAR, 1e18: SaucerSwap's from the quote, Chainlink's back out of the floor.
  const saucerPrice = quote !== undefined && amount ? (quote * 10n ** 20n) / amount : undefined;
  const oraclePrice =
    floor !== undefined && amount && bandBps !== undefined && bandBps < 10_000n
      ? (floor * 10n ** 20n * 10_000n) / (amount * (10_000n - bandBps))
      : undefined;
  const farFromOracle =
    saucerPrice !== undefined &&
    !!oraclePrice &&
    (saucerPrice * 100n > oraclePrice * 105n || saucerPrice * 100n < oraclePrice * 95n);

  return (
    <form noValidate onSubmit={e => e.preventDefault()}>
      <PillChoice
        legend="Pay with"
        name={`${id}-pay`}
        options={[
          ["usdc", "USDC"],
          ["hbar", "HBAR via SaucerSwap"],
        ]}
        value={payWith}
        onChange={v => {
          setPayWith(v);
          setText("");
          setError(undefined);
          setDone(undefined);
        }}
      />

      <AmountField
        id={`${id}-amount`}
        label={hbar ? "HBAR to swap and deposit" : "Amount to deposit"}
        value={text}
        onChange={v => {
          setText(v);
          setDone(undefined);
        }}
        unit={hbar ? "HBAR" : "USDC"}
        problem={problem}
        onMax={(hbar ? hbarBalance?.value : usdc.balance) ? setMax : undefined}
        maxLabel={hbar ? "Deposit all your HBAR, less the network fee" : "Deposit all your USDC"}
        helper={
          hbar ? (
            hbarBalance === undefined ? (
              "Reading your HBAR balance…"
            ) : hbarBalance.value === 0n ? (
              <>
                You have no HBAR.{" "}
                <a className="link" href={HBAR_FAUCET} target="_blank" rel="noreferrer">
                  Get testnet HBAR from the Hedera Portal faucet
                </a>
                .
              </>
            ) : (
              <>
                In your wallet: {fmtHbar(hbarBalance.value)} HBAR. SaucerSwap swaps it to USDC and the pool takes the
                USDC, in one transaction.
              </>
            )
          ) : usdc.balance === undefined ? (
            "Reading your USDC balance…"
          ) : usdc.balance === 0n ? (
            <>
              You have no USDC.{" "}
              <a className="link" href={USDC_FAUCET} target="_blank" rel="noreferrer">
                Get testnet USDC from Circle
              </a>{" "}
              (pick Hedera testnet), or pay with HBAR.
            </>
          ) : (
            <>In your wallet: {fmtUsdc(usdc.balance)} USDC</>
          )
        }
      />

      {hbar && (
        <div className="mt-4">
          <PillChoice
            legend="Slippage you accept"
            name={`${id}-slippage`}
            options={SLIPPAGE_OPTIONS.map(s => [s, `${Number(s) / 100}%`] as const)}
            value={slippageBps}
            onChange={setSlippageBps}
          />
        </div>
      )}

      <div className={`rounded-box bg-base-200 p-4 text-sm ${hbar ? "" : "mt-4"}`} aria-live="polite">
        {hbar && (
          <>
            <Row label="SaucerSwap gives about">
              {quote !== undefined ? `${fmtUsdc(quote, 4)} USDC` : amount && !zapError ? "…" : "—"}
            </Row>
            <Row label="The swap must return">{mustGet !== undefined ? `${fmtUsdc(mustGet, 4)} USDC` : "—"}</Row>
            <p className="mt-1 mb-2 text-xs leading-relaxed text-base-content/60">
              The larger of the quote less your {Number(slippageBps) / 100}% slippage and the Chainlink value of your
              HBAR less {band}
              {floor !== undefined ? ` (${fmtUsdc(floor, 4)} USDC)` : ""}. If SaucerSwap would give less, nothing is
              swapped.
            </p>
          </>
        )}
        <Row label="You get about">
          {amount && preview !== undefined && fresh && (!hbar || quote !== undefined)
            ? `${fmt(preview, shares.decimals ?? 6, 4)} ${symbol}`
            : "—"}
        </Row>
        <Row label="Share price">{fmtUsdc(pool.sharePrice, 4)} USDC</Row>
      </div>

      {hbar && farFromOracle && (
        <p className="mt-2 mb-0 text-xs leading-relaxed text-base-content/70">
          SaucerSwap&apos;s testnet pool prices HBAR at ${fmt(saucerPrice, 18, 4)}, against Chainlink&apos;s $
          {fmt(oraclePrice, 18, 5)}. Testnet pools are thin. The zap only refuses fills more than {band} below the
          oracle value, so this one goes through; on mainnet the two track closely.
        </p>
      )}

      {zapError && (
        <p role="alert" className="mt-4 mb-0 rounded-box bg-warning/15 p-4 text-sm leading-relaxed">
          {poolErrorMessage(zapError, { shareDecimals: shares.decimals, shareSymbol: symbol })}
        </p>
      )}
      {belowFloor && (
        <p role="alert" className="mt-4 mb-0 rounded-box bg-warning/15 p-4 text-sm leading-relaxed">
          SaucerSwap would give {fmtUsdc(quote, 4)} USDC, below the zap&apos;s floor of {fmtUsdc(floor, 4)} USDC (the
          Chainlink value less {band}), so the zap would refuse it. Deposit with USDC instead.
        </p>
      )}

      <AccountBlocker pool={pool} />
      <ErrorBox error={error} ctx={{ shareDecimals: shares.decimals, shareSymbol: symbol }} />
      {done && (
        <p role="status" className="mt-4 mb-0 rounded-box bg-success/15 p-4 text-sm">
          {done}
        </p>
      )}

      <PoolSteps
        steps={steps}
        disabled={
          !amount ||
          !!problem ||
          overBalance ||
          blocked(pool) ||
          (hbar && (minUsdc === undefined || !!zapError || belowFloor))
        }
        onError={setError}
        onDone={() => {
          setDone(
            hbar
              ? `Swapped ${fmt(amount, HBAR_DECIMALS, 4)} HBAR on SaucerSwap and deposited the USDC. Your shares are in your wallet.`
              : `Deposited ${fmtUsdc(amount)} USDC. Your shares are in your wallet.`,
          );
          setText("");
          pool.refetch();
        }}
      />
      <p className="mt-4 mb-0 text-xs leading-relaxed text-base-content/60">
        Your deposit backs every open trade. If traders win more than they lose, the share price falls; fees,
        liquidations and trader losses raise it.
      </p>
    </form>
  );
};

type Unit = "usdc" | "shares";

const WithdrawForm = ({ pool, owner }: { pool: PoolState; owner: Address }) => {
  const id = useId();
  const { usdc, shares, me } = pool;
  const shareDecimals = shares.decimals ?? 6;
  const symbol = shares.symbol ?? "cUSDC-LP";
  const [unit, setUnit] = useState<Unit>("usdc");
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState<string>();
  const decimals = unit === "usdc" ? USDC_DECIMALS : shares.decimals;
  const amount = parseAmount(text, decimals);
  const [debounced] = useDebounceValue(amount, PREVIEW_DEBOUNCE_MS);
  const { withdraw, redeem } = usePoolWrite(owner);

  // USDC mode: how many shares the exact USDC amount burns. Shares mode: how much USDC the shares redeem for.
  const { data: sharesForAssets } = useScaffoldReadContract({
    contractName: "LiquidityPool",
    functionName: "previewWithdraw",
    args: [unit === "usdc" ? debounced : undefined],
    ...POLL,
  });
  const { data: assetsForShares } = useScaffoldReadContract({
    contractName: "LiquidityPool",
    functionName: "previewRedeem",
    args: [unit === "shares" ? debounced : undefined],
    ...POLL,
  });
  const fresh = amount !== undefined && debounced === amount;
  const sharesNeeded = unit === "shares" ? amount : fresh ? sharesForAssets : undefined;

  const max = unit === "usdc" ? me.maxWithdraw : me.maxRedeem;
  const capped = me.value !== undefined && me.maxWithdraw !== undefined && me.maxWithdraw < me.value;
  const overMax = amount !== undefined && max !== undefined && amount > max;
  const fmtUnit = (v?: bigint) => (unit === "usdc" ? `${fmtUsdc(v)} USDC` : `${fmt(v, shareDecimals, 4)} ${symbol}`);
  const problem =
    amountProblem(text, decimals) ??
    (overMax
      ? capped
        ? `You can take out ${fmtUnit(max)} right now. The rest of your share is backing open positions; withdrawals stop at the pool's free USDC.`
        : `That's more than you hold. The most is ${fmtUnit(max)}.`
      : undefined);

  // Shares can drift between the approval and the withdrawal as the price moves; approve a 0.1% margin, capped at
  // what the LP holds.
  const approveFor = (need: bigint) => {
    const withMargin = need + need / 1000n;
    return shares.balance !== undefined && withMargin > shares.balance ? shares.balance : withMargin;
  };

  const steps: Step[] = [
    ...associateStep(usdc, "assoc-usdc", "Associate your account with USDC to receive it"),
    {
      key: "approve-shares",
      label: `Let the pool take your ${symbol}`,
      done: sharesNeeded !== undefined && shares.allowance !== undefined && shares.allowance >= sharesNeeded,
      action: `Approve ${symbol}`,
      run: () => shares.approve(approveFor(sharesNeeded!)),
    },
    {
      key: "withdraw",
      label: "Withdraw",
      done: false,
      action: amount ? `Withdraw ${fmtUnit(amount)}` : "Withdraw",
      run: () => (unit === "usdc" ? withdraw(amount!) : redeem(amount!)),
    },
  ];

  const hasShares = shares.balance !== undefined && shares.balance > 0n;

  return (
    <form noValidate onSubmit={e => e.preventDefault()}>
      <fieldset className="m-0 mb-4 border-0 p-0">
        <legend className="mb-2 text-sm">Withdraw by</legend>
        <div className="inline-flex rounded-full bg-base-200 p-1 text-sm">
          {(
            [
              ["usdc", "USDC amount"],
              ["shares", "Shares"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-full px-4 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                unit === value ? "bg-base-100 shadow-sm" : "text-base-content/70"
              }`}
            >
              <input
                type="radio"
                name={`${id}-unit`}
                value={value}
                checked={unit === value}
                onChange={() => {
                  setUnit(value);
                  setText("");
                  setError(undefined);
                }}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <AmountField
        id={`${id}-amount`}
        label={unit === "usdc" ? "USDC to receive" : `${symbol} to redeem`}
        value={text}
        onChange={v => {
          setText(v);
          setDone(undefined);
        }}
        unit={unit === "usdc" ? "USDC" : symbol}
        problem={problem}
        onMax={max ? () => setText(formatUnits(max, decimals ?? 0)) : undefined}
        maxLabel="Withdraw the most you can right now"
        helper={
          !hasShares
            ? shares.balance === undefined
              ? "Reading your shares…"
              : "You have no pool shares to withdraw."
            : `You can take out ${fmtUnit(max)} now.`
        }
      />

      <div className="mt-4 rounded-box bg-base-200 p-4 text-sm" aria-live="polite">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-base-content/70">{unit === "usdc" ? "Shares burned" : "You receive about"}</span>
          <span className="tabular-nums">
            {!fresh
              ? "—"
              : unit === "usdc"
                ? sharesForAssets === undefined
                  ? "…"
                  : `${fmt(sharesForAssets, shareDecimals, 4)} ${symbol}`
                : assetsForShares === undefined
                  ? "…"
                  : `${fmtUsdc(assetsForShares)} USDC`}
          </span>
        </div>
      </div>

      {capped && (
        <p className="mt-4 mb-0 text-sm leading-relaxed text-base-content/70">
          Part of your share is backing open positions. The pool keeps twice the open interest, so withdrawals stop at
          its free USDC ({fmtUsdc(pool.freeAssets)} now). It frees up as traders close.
        </p>
      )}

      <AccountBlocker pool={pool} />
      <ErrorBox error={error} ctx={{ shareDecimals, shareSymbol: symbol, exitUnit: unit }} />
      {done && (
        <p role="status" className="mt-4 mb-0 rounded-box bg-success/15 p-4 text-sm">
          {done}
        </p>
      )}

      <PoolSteps
        steps={steps}
        disabled={!hasShares || !amount || !!problem || blocked(pool)}
        onError={setError}
        onDone={() => {
          setDone(`Withdrew ${fmtUnit(amount)}. The USDC is in your wallet.`);
          setText("");
          pool.refetch();
        }}
      />
    </form>
  );
};
