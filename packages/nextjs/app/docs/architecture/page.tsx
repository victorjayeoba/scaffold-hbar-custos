import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, H2, HashScan, Prose, Step, Steps, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "How it works",
  description: "The Custos contracts, how they fit together, and a network-run liquidation from start to finish.",
});

const DIAGRAM = `
Trader --open / close / closeToHbar-->  PerpMarket  --read() / prices()-->  PriceGuard
                                         |   ^   |                           |-- Chainlink HBAR/USD
                     payTrader /         |   |   |                           '-- Supra HBAR/USDT
                     payKeeper           v   |   '--swap HBAR <-> USDC-->  SaucerSwap V1
LP --deposit / redeem-->  LiquidityPool      |
                              |              | tick() at nextRunAt; each tick books the next
                              |          Hedera Schedule Service (0x16b)
                              '--mints / burns-->  cUSDC-LP (HTS token)
`;

export default function Architecture() {
  return (
    <Doc
      href="/docs/architecture"
      section="Getting started"
      title="How it works"
      lead="Custos is three reusable contracts and a market built from them. Traders put collateral in the market, a liquidity pool takes the other side, and the Hedera Schedule Service calls the market on a timer to charge funding and liquidate."
    >
      <H2>The parts</H2>
      <CodeBlock lang="text" title="contracts" code={DIAGRAM} />
      <Prose>
        <ul>
          <li>
            <strong>
              <Code>PerpMarket</Code>
            </strong>{" "}
            is the HBAR-USD market, settled in USDC. It inherits <Code>MarginAccount</Code> (the position book and risk
            math) and <Code>ScheduledKeeper</Code> (the timer), and reads every price from <Code>PriceGuard</Code>.
          </li>
          <li>
            <strong>
              <Code>PriceGuard</Code>
            </strong>{" "}
            uses Chainlink as the price and Supra as the cross-check. It reports <Code>Stale</Code> if either feed is
            older than <Code>maxStaleness</Code> (or dated more than 5 minutes in the future) and <Code>Deviated</Code>{" "}
            if they differ by more than <Code>maxDeviationBps</Code>. It never reverts on a broken feed.
          </li>
          <li>
            <strong>
              <Code>LiquidityPool</Code>
            </strong>{" "}
            holds LP USDC and mints cUSDC-LP, a native Hedera token it created itself. It is every trader&apos;s
            counterparty.
          </li>
          <li>
            <strong>
              <Code>HbarDepositZap</Code>
            </strong>{" "}
            is optional periphery: it swaps an LP&apos;s HBAR to USDC on SaucerSwap and deposits it in one transaction.
          </li>
        </ul>
      </Prose>

      <H2>How the money moves</H2>
      <Prose>
        <ul>
          <li>
            <strong>Collateral sits in the market; the pool backs every position.</strong> On close the market pays the
            collateral back and the pool covers any profit above it, or keeps any loss. On liquidation the collateral
            goes to the pool, minus a 0.5% reward if a person liquidated, and nothing if the network did.
          </li>
          <li>
            <strong>Open interest is capped at 50% of the pool&apos;s USDC.</strong> Each position&apos;s gain is capped
            at its entry notional, and LPs can&apos;t withdraw below twice the open interest, so the pool can always pay
            every position&apos;s largest possible gain.
          </li>
          <li>
            <strong>The pool is priced at what it is really worth:</strong> its USDC minus what traders are up on open
            positions, or plus what they are down. Running sums in <Code>MarginAccount</Code> give that number in O(1).
            Without it, anyone could deposit just before a loss lands in the pool and withdraw just after.
          </li>
          <li>
            <strong>Funding</strong> is charged to the heavier side and the net goes to the pool. The pool calls{" "}
            <Code>accrueFunding()</Code> before every deposit and withdrawal so funding is measured against the assets
            that were really there.
          </li>
        </ul>
      </Prose>

      <H2>A liquidation, end to end</H2>
      <Prose>
        <p>
          This is what one network tick does. Tick 4 on the live deploy (
          <HashScan kind="transaction" id="0x7c37d2a7399f66bc85fe549a12766212d8622ed0a31911959c204e588dde59a9" />)
          followed exactly these steps and liquidated a 50x short with nobody signing.
        </p>
      </Prose>
      <Steps>
        <Step title="The network calls tick()">
          <p>
            The previous tick booked a call to <Code>tick()</Code> at <Code>nextRunAt</Code> on the Schedule Service (
            <Code>0x16b</Code>). At that second Hedera executes it. <Code>tick()</Code> accepts up to 5 seconds early,
            because <Code>block.timestamp</Code> is the start of Hedera&apos;s ~2 s block.
          </p>
        </Step>
        <Step title="msg.sender is the contract itself">
          <p>
            When the Schedule Service runs a call the contract booked, <Code>msg.sender</Code> and{" "}
            <Code>tx.origin</Code> are the contract&apos;s own address. <Code>tick()</Code> accepts nothing else, so
            nobody can tick early, starve it of gas or make a booked run revert.
          </p>
        </Step>
        <Step title="Record the gas price">
          <p>
            Inside a scheduled run <Code>tx.gasprice</Code> is the network gas price in tinybars (82 to 84 on testnet).
            The tick stores it, so <Code>runCostEstimate()</Code> follows the real price. It also sets{" "}
            <Code>lastRunAt</Code> and increments <Code>runCount</Code>.
          </p>
        </Step>
        <Step title="runWork() as a self-call">
          <p>
            The job runs through <Code>this.runWork()</Code> with all gas except 1.6M. A revert inside is caught and
            reported in <Code>Ticked(run, workOk, reason)</Code>, so it can&apos;t stop the next tick from being booked.
          </p>
        </Step>
        <Step title="Accrue funding">
          <p>The funding index is brought up to the current second.</p>
        </Step>
        <Step title="Read the guard">
          <p>
            <Code>guard.read()</Code> returns the price and a status: <Code>Ok</Code>, <Code>Stale</Code> or{" "}
            <Code>Deviated</Code>.
          </p>
        </Step>
        <Step title="Sweep up to 50 positions while gas lasts">
          <p>
            At an <Code>Ok</Code> price the market walks the trader list from <Code>cursor</Code>. A position is
            liquidatable when its equity (collateral + PnL − funding) is below its maintenance margin, 1% of notional.
            The sweep stops after 50 positions or when less than 150,000 gas is left, emits{" "}
            <Code>Swept(from, to, liquidated)</Code>, and resumes from the cursor next tick.
          </p>
        </Step>
        <Step title="Liquidate with byNetwork = true, reward 0">
          <p>
            The position is removed and all its collateral goes to the pool. The event is{" "}
            <Code>Liquidated(trader, price, byNetwork = true, by = 0x0, reward = 0)</Code>.
          </p>
        </Step>
        <Step title="At a bad price: SweepSkipped">
          <p>
            If the status is <Code>Stale</Code> or <Code>Deviated</Code>, nothing is liquidated and the tick emits{" "}
            <Code>SweepSkipped(status)</Code>. Ticks 12 to 16 on the live deploy did this while Chainlink&apos;s testnet
            feed was hours old.
          </p>
        </Step>
        <Step title="Refuel if the reserve is low (optional)">
          <p>
            If the HBAR reserve covers fewer than 12 runs, the tick tries <Code>refuel()</Code>: the pool pays up to 50
            USDC that no position needs, and SaucerSwap swaps it to HBAR. The swap must fill within 3% of the oracle
            price, and a failure is caught so it never undoes the sweep. On testnet it fails closed (see{" "}
            <Link href="/docs/guides/keeper">The keeper</Link>).
          </p>
        </Step>
        <Step title="Book the next tick">
          <p>
            The keeper checks <Code>hasScheduleCapacity</Code> for <Code>now + interval</Code> (trying up to 10
            consecutive seconds) and calls <Code>scheduleCall</Code> for <Code>tick()</Code> with the full gas limit.
            Booking costs about 1.41M gas, which is why 1.6M is always held back from the job.
          </p>
        </Step>
      </Steps>
      <Callout title="If a booking fails">
        <p>
          <Code>nextRunAt</Code> still moves forward, and anyone can call <Code>revive()</Code> once the tick is{" "}
          <Code>2 × interval</Code> overdue. Details in <Link href="/docs/guides/keeper">The keeper</Link>.
        </p>
      </Callout>

      <H2>Constants</H2>
      <Table
        head={["Constant", "Value"]}
        rows={[
          ["Max leverage", "50x"],
          ["Maintenance margin", "1% of notional"],
          ["Open fee / close fee", "0.1% of notional each, to the pool"],
          ["Manual liquidation reward", "0.5% of notional (network liquidations pay none)"],
          ["Min hold before close", "300 s"],
          ["Open interest cap", "50% of the pool's USDC"],
          ["Funding", "0.1%/h × (long − short) / pool USDC; the heavy side pays, net to the pool"],
          ["Sweep", "50 positions per tick, stops under 150,000 gas left, resumes next tick"],
          ["Gas held back for booking", "1,600,000"],
          ["Refuel", "below 12 runs, back up to 48, at most 50 USDC, within 3% of the oracle"],
          ["Min collateral (testnet deploy)", "1 USDC"],
          ["Keeper (testnet deploy)", "interval 1,800 s, gas limit 3,000,000, starting gas price 82 tinybar/gas"],
          ["PriceGuard (HBAR-USD)", "max staleness 43,200 s (12 h), max deviation 500 bps"],
        ]}
      />

      <H2>Units</H2>
      <Table
        head={["Quantity", "Unit", "Note"]}
        rows={[
          ["Position size", "HBAR, 1e18; + long, − short", "For another market, that asset's units"],
          ["Price", "USD per HBAR, 1e18", "Chainlink (8 dp) and Supra (18 dp) are scaled to 1e18"],
          ["Money", "USDC, 6 dp", <Code key="m">size × price / 1e30 = USDC</Code>],
          [
            "HBAR inside the EVM",
            "tinybars (1 HBAR = 1e8)",
            <>
              <Code>msg.value</Code>, balances, <Code>tx.gasprice</Code>
            </>,
          ],
        ]}
      />
      <Prose>
        <p>
          Every function and event is listed in the <Link href="/docs/integrate/contracts">Contract reference</Link>.
        </p>
      </Prose>
    </Doc>
  );
}
