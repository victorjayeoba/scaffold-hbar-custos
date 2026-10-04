import type { ReactNode } from "react";
import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Code, H2, Prose, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Troubleshooting",
  description:
    "Every Custos custom error with its selector, what it means and what to do about it, plus the honest limits.",
});

const HEAD = ["Error (selector)", "Means", "Fix"];

/** The first cell of an error row: the error name and, when it has one, its 4-byte selector. */
function err(name: string, selector?: string) {
  return (
    <>
      <Code>{name}</Code>
      {selector && <span className="block font-mono text-xs text-base-content/60">{selector}</span>}
    </>
  );
}

const c = (text: string): ReactNode => <Code>{text}</Code>;

export default function Troubleshooting() {
  return (
    <Doc
      href="/docs/troubleshooting"
      section="Reference"
      title="Troubleshooting"
      lead="Every custom error the contracts raise, what it means and what to do about it, grouped by contract. Then the limits we know about."
    >
      <H2>Common situations</H2>
      <Prose>
        <ul>
          <li>
            <strong>The keeper stopped.</strong> Usually the reserve can&apos;t cover the next run&apos;s gas hold (
            <Code>gasLimit × gasPrice</Code>), so the scheduled run failed <Code>INSUFFICIENT_PAYER_BALANCE</Code> and
            nothing booked the next one. Check <Code>canPayNextRun()</Code>, <Code>fund()</Code> the market, then call{" "}
            <Code>revive()</Code> once the tick is overdue (<Code>nextRunAt + 2 × interval</Code>). <Code>/keeper</Code>{" "}
            has both buttons; see <Link href="/docs/guides/keeper">The keeper</Link>.
          </li>
          <li>
            <strong>The market is close-only.</strong> The price is <Code>Stale</Code> or <Code>Deviated</Code>: opens,
            manual liquidations and refuels refuse it, and the keeper skips the sweep. Wait for the feeds;{" "}
            <Code>PriceGuard.read()</Code> says which feed is old or how far apart they are.
          </li>
          <li>
            <strong>A deposit reverts with </strong>
            <Code>LiquidityPool__NoPrice</Code>. Deposits and withdrawals pause while positions are open and the price
            isn&apos;t <Code>Ok</Code>, so shares are never priced at a bad price. Wait for the feeds.
          </li>
          <li>
            <strong>
              <Code>LiquidityPool__HtsFailed</Code> with rc 184
            </strong>{" "}
            (<Code>TOKEN_NOT_ASSOCIATED_TO_ACCOUNT</Code>). The receiver isn&apos;t associated with cUSDC-LP: call{" "}
            <Code>associate()</Code> on the share token (the Pool page does it for you).
          </li>
        </ul>
      </Prose>

      <H2>Keeper</H2>
      <Table
        head={HEAD}
        rows={[
          [
            err("ScheduledKeeper__OnlyNetwork", "0xe3093212"),
            <>Someone other than the Schedule Service called {c("tick()")}</>,
            <>Nothing to fix: only the network ticks. To restart a stopped chain use {c("revive()")}</>,
          ],
          [
            err("ScheduledKeeper__TooEarly(nextRunAt)", "0x6f69966d"),
            <>
              A tick arrived more than 5 s before {c("nextRunAt")}, or no tick is booked ({c("nextRunAt")} 0)
            </>,
            <>
              Wait; if {c("nextRunAt")} is 0, call {c("revive()")}
            </>,
          ],
          [
            err("ScheduledKeeper__NotOverdue(overdueAt)", "0x0681ef5d"),
            <>{c("revive()")} while the chain is still healthy</>,
            <>
              Revive only after {c("overdueAt")} = {c("nextRunAt + 2 × interval")}
            </>,
          ],
          [
            err("ScheduledKeeper__InvalidConfig", "0xc13e0c4e"),
            "Interval 0, gas limit ≤ 1.6M, or gas price > 1,000,000",
            "Use a gas limit above 1,600,000",
          ],
          [
            err("ScheduledKeeper__Reentrant / OnlySelf"),
            "Internal guards",
            <>
              Don&apos;t call {c("runWork()")} or re-enter {c("tick()")}/{c("revive()")} from {c("_work()")}
            </>,
          ],
        ]}
      />

      <H2>PriceGuard</H2>
      <Table
        head={HEAD}
        rows={[
          [
            err("PriceGuard__NotOk(status)", "0x9bf2faf0"),
            <>
              Price is {c("Stale")} (1) or {c("Deviated")} (2): opens, manual liquidations and refuels refuse it
            </>,
            <>Wait for the feeds; check {c("read()")} for which feed is old or how far apart they are</>,
          ],
          [
            err("PriceGuard__InvalidConfig", "0x9625e495"),
            "Zero feed address, Chainlink decimals > 18, staleness 0 or > 1 day, deviation 0 or > 2,000 bps",
            <>Fix the market&apos;s config (its entry in {c("markets.json")})</>,
          ],
        ]}
      />

      <H2>PerpMarket</H2>
      <Table
        head={HEAD}
        rows={[
          [
            err("PerpMarket__BelowMinCollateral(min)", "0x3fe7dc18"),
            <>
              Collateral (or what {c("openWithHbar")}&apos;s swap returned) is under {c("minCollateral")}
            </>,
            "Put up more; 1 USDC on the testnet deploy (~0.45 ℏ at SaucerSwap testnet's rate)",
          ],
          [
            err("PerpMarket__InvalidLeverage", "0xca94e446"),
            "Leverage 0 or > 50, or the open fee would eat the collateral",
            "Use 1–50",
          ],
          [
            err("PerpMarket__OpenInterestCap(cap)", "0xf5de5219"),
            "The pool can't back a position this big",
            "Smaller size, or more pool liquidity",
          ],
          [err("PerpMarket__PositionExists / NoPosition"), "One position per account", "Close first / open first"],
          [
            err("PerpMarket__HoldTime(closeableAt)", "0x52765821"),
            "Closing within 300 s of opening",
            <>Wait until {c("closeableAt")}</>,
          ],
          [
            err("PerpMarket__NoPrice", "0x5cda1032"),
            "Neither feed is fresh (younger than maxStaleness), so there's no price to close at",
            "Wait for a feed to push again",
          ],
          [err("PerpMarket__NotLiquidatable", "0x2103964c"), "The position isn't underwater at the current price", "—"],
          [
            err("PerpMarket__SwapDisabled", "0x0002a87d"),
            "Deployed without a SaucerSwap router",
            <>
              Use {c("open")} / {c("close")} with USDC
            </>,
          ],
          [
            err("PerpMarket__OnlyKeeper", "0xeee4b657"),
            <>{c("refuel()")} called by someone else</>,
            "Only the keeper's tick refuels",
          ],
          [err("PerpMarket__ReserveNotLow / NothingToSpend"), "Refuel not needed / the pool has no free USDC", "—"],
        ]}
      />

      <H2>LiquidityPool</H2>
      <Table
        head={HEAD}
        rows={[
          [
            err("LiquidityPool__NoPrice", "0x40c172d5"),
            <>Deposits and withdrawals pause while positions are open and the price isn&apos;t {c("Ok")}</>,
            "Wait for the feeds",
          ],
          [
            err("LiquidityPool__ExceedsMax(max)", "0x139fca36"),
            "More than you hold, or more than the pool can release (it keeps 2 × open interest)",
            <>
              Use {c("maxRedeem")} / {c("maxWithdraw")}
            </>,
          ],
          [
            err("LiquidityPool__TooFewShares(shares)", "0x8811e726"),
            "First deposit must exceed the 1,000 dead shares (0.001 USDC)",
            "Deposit more",
          ],
          [
            err("LiquidityPool__NoShareToken / ShareTokenExists"),
            <>{c("createShareToken()")} not called yet / already called</>,
            <>Run {c("yarn custos:deploy:testnet")} (it creates it)</>,
          ],
          [
            err("LiquidityPool__HtsFailed(rc)", "0x0c9ebca3"),
            <>The Token Service refused a mint/burn/transfer; {c("rc")} is the Hedera response code</>,
            <>
              Usually the receiver isn&apos;t associated with cUSDC-LP (rc 184 {c("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT")}):
              call {c("associate()")} on the share token
            </>,
          ],
          [
            err("LiquidityPool__OnlyMarket / ExceedsFreeAssets"),
            "Only the market draws on the pool, and only from USDC no position needs",
            "—",
          ],
        ]}
      />

      <H2>SaucerSwap and Hedera</H2>
      <Table
        head={["Error", "Means", "Fix"]}
        rows={[
          [
            err("INSUFFICIENT_PAYER_BALANCE"),
            <>
              A scheduled run failed to start: the reserve can&apos;t cover {c("gasLimit × gasPrice")}. The failed
              attempt still costs 0.018 ℏ
            </>,
            <>
              {c("fund()")} the market (check {c("canPayNextRun()")}), then {c("revive()")} once overdue
            </>,
          ],
          [
            err('"slippage" (SaucerSwap)'),
            "The swap would return less than your minimum (or, for refuel, less than 97% of the oracle price)",
            <>
              Re-quote with {c("quoteHbarToUsdc")} / {c("quoteUsdcToHbar")}; on testnet refuels fail this way by design
              (<Link href="/docs/hedera-notes">Learned on Hedera</Link>, item 8)
            </>,
          ],
          [
            err("CONTRACT_EXECUTION_EXCEPTION"),
            "The relay rejects a deploy: the contract is over 24 KB",
            <>Keep the optimizer on ({c("foundry.toml")})</>,
          ],
        ]}
      />

      <H2>Honest limits</H2>
      <Prose>
        <ul>
          <li>
            <strong>Testnet refuels fail closed.</strong> SaucerSwap testnet&apos;s USDC pool is ~22x off the oracle, so
            the keeper is funded by hand on testnet. Self-refuel is proven by tests at sane prices.
          </li>
          <li>
            <strong>The keeper costs real HBAR.</strong> About 1.4 ℏ per run, ~65 ℏ a day at a 30 min interval. When the
            reserve can&apos;t cover the next run&apos;s gas hold, the chain stops until someone funds and revives it.
          </li>
          <li>
            <strong>Push oracles lag.</strong> Chainlink and Supra update on deviation or heartbeat, so the market
            trades on a price that can be minutes old, and a 50x position can be hit by oracle lag. The 300 s minimum
            hold and the 0.1% fees blunt it; they don&apos;t remove it.
          </li>
          <li>
            <strong>Liquidation keeps the remainder.</strong> A liquidated position&apos;s leftover equity (up to 1% of
            notional) goes to the pool, not back to the trader.
          </li>
          <li>
            <strong>The pool&apos;s value ignores the per-position gain cap and loss floor.</strong> Exact until a
            position is past +100% or below zero equity; liquidation keeps positions away from the floor.
          </li>
          <li>
            <strong>LPs are locked while prices are bad.</strong> Deposits and withdrawals pause while positions are
            open and the price isn&apos;t <Code>Ok</Code>, so shares are never priced at a bad price.
          </li>
          <li>
            <strong>One position per account, one market per deployment.</strong> More markets are more deployments from{" "}
            <Code>markets.json</Code>; the app shows the default market.
          </li>
          <li>
            <strong>Funding is linear and simple</strong> (skew / pool assets); there&apos;s no price impact and no
            borrow fee.
          </li>
          <li>
            <strong>The keeper&apos;s HBAR can&apos;t be withdrawn.</strong> It can only pay for network runs.
            Redeploying leaves the old reserve behind.
          </li>
          <li>
            <strong>The owner can tune, not take.</strong> PerpMarket&apos;s owner can only correct the gas-price
            estimate; PriceGuard&apos;s owner can only change staleness/deviation within hard bounds; the pool&apos;s
            owner links the market and creates the share token once each. No one can move user funds.
          </li>
          <li>
            <strong>The live testnet deploy predates the stale-close fix.</strong> A review on 2026-10-03 found that,
            with one feed down, <Code>closePrice()</Code> used the other feed without checking its age, so a trader
            could close at an old price that favoured them. The source now settles a close only at a feed younger than{" "}
            <Code>maxStaleness</Code> (and waits if neither is), and treats a feed timestamp more than 5 minutes in the
            future as stale (<Code>PriceGuard.MAX_FUTURE_SKEW</Code>); regression tests replay the attack. The contracts
            deployed on 2026-10-02 still have the old behaviour. On testnet the exposure needs Chainlink to stop
            answering while Supra is stale at a favourable price, and is capped by each position&apos;s gain cap; the
            live deploy was kept rather than strand its funded keeper reserve and its network-run proofs. A new deploy
            from this source has the fix.
          </li>
          <li>
            <strong>Testnet assets.</strong> USDC 0.0.5449 is SaucerSwap&apos;s testnet token.
          </li>
          <li>
            <strong>Local chain is for trading and the pool only.</strong> <Code>yarn foundry:chain</Code> +{" "}
            <Code>yarn foundry:deploy</Code> runs everything on mocks with stand-ins for the two system contracts; the
            keeper books ticks but nothing runs them, and the mock feeds go <Code>Stale</Code> 2 h after deploy (move
            them with <Code>MockAggregator.set</Code> / <Code>MockSupra.set</Code> from <Code>/debug</Code>).
          </li>
        </ul>
      </Prose>
    </Doc>
  );
}
