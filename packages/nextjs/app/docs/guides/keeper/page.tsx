import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, Figure, H2, HashScan, Prose, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "The keeper",
  description: "How the Hedera network ticks the Custos market, what a run costs, and how to fund or revive it.",
});

export default function KeeperGuide() {
  return (
    <Doc
      href="/docs/guides/keeper"
      section="Using the app"
      title="The keeper"
      lead="There is no keeper bot. Every interval the Hedera Schedule Service calls the market's tick(), which charges funding, liquidates underwater positions and books the next tick. The market pays for each run from its own HBAR reserve."
    >
      <H2>What a tick does</H2>
      <Prose>
        <ol>
          <li>
            Accepts the call only if <Code>msg.sender</Code> is the market itself, which is what a scheduled run looks
            like on Hedera.
          </li>
          <li>Records the gas price it ran at.</li>
          <li>Accrues funding.</li>
          <li>
            Reads <Code>PriceGuard</Code>. At an <Code>Ok</Code> price it checks up to 50 positions and liquidates the
            underwater ones for no reward; otherwise it emits <Code>SweepSkipped</Code>.
          </li>
          <li>Tries to refuel from the pool if fewer than 12 runs are left.</li>
          <li>Books the next tick one interval later.</li>
        </ol>
        <p>
          The step-by-step version is in <Link href="/docs/architecture">How it works</Link>. On the testnet deploy the
          interval is 1,800 s and each tick is booked with 3,000,000 gas.
        </p>
      </Prose>

      <H2>The /keeper page</H2>
      <Figure
        src="/docs/shot-keeper.png"
        alt="The keeper page: next check countdown, fee reserve, price feeds, network activity and the HCS audit log"
        caption="/keeper on the live testnet deployment"
        width={1280}
        height={800}
      />
      <Table
        head={["Panel", "What it shows"]}
        rows={[
          [
            "Heartbeat",
            "Next check in (countdown), Booked for, Checks run, Last check, Booked schedule, Market contract, Can pay next run",
          ],
          [
            "Fee reserve",
            "In the reserve, Runs it can start, Held up front per run (runCostEstimate()), Gas price, Refuels itself",
          ],
          ["Keep it running", "Fund and Revive the keeper buttons. Anyone can use both."],
          [
            "Prices the keeper trusts",
            "Chainlink and Supra ages against the limit, how far apart they are, and whether the market is Open or Close-only",
          ],
          [
            "What the network did",
            "Keeper events from the mirror node, newest first. A teal dot marks a run executed by the Schedule Service with no signer.",
          ],
          ["Audit log on HCS", "The same events as messages on topic 0.0.10839050, each linked to its transaction"],
        ]}
      />

      <H2>What a run costs</H2>
      <Prose>
        <p>
          Hedera holds a scheduled run&apos;s whole gas limit up front and only starts the run if the payer can cover
          it. Afterwards it charges only the gas the run used.
        </p>
      </Prose>
      <CodeBlock
        lang="text"
        title="cost model"
        code={`held up front = gasLimit × gasPrice = 3,000,000 × 82 tinybar = 2.46 ℏ
charged       = gas used × gasPrice`}
      />
      <Table
        head={["Tick", "Did", "Gas used", "Charged"]}
        rows={[
          [
            <HashScan
              key="1"
              kind="transaction"
              id="0x5bebf1d891890489514a052be62988357a00dc621b9fa19a6fe09f80de0038f6"
              label="1"
            />,
            "Funding, swept 2 positions, booked tick 2",
            "1,618,265",
            "1.359 ℏ",
          ],
          [
            <HashScan
              key="2"
              kind="transaction"
              id="0x756e4e8e11bf69370a543a2d518e905c868aca2361ba606455b803140a8c518a"
              label="2"
            />,
            "Funding, sweep, booked tick 3",
            "1,580,037",
            "1.327 ℏ",
          ],
          [
            <HashScan
              key="3"
              kind="transaction"
              id="0xcaaa44b5a61366f099f2d334c571e1d578b198357ea07dc56c350c980e38aef3"
              label="3"
            />,
            "Funding, sweep, booked tick 4",
            "1,584,087",
            "1.315 ℏ",
          ],
          [
            <HashScan
              key="4"
              kind="transaction"
              id="0x7c37d2a7399f66bc85fe549a12766212d8622ed0a31911959c204e588dde59a9"
              label="4"
            />,
            "Also liquidated a 50x short",
            "2,385,537",
            "1.980 ℏ",
          ],
        ]}
      />
      <Prose>
        <ul>
          <li>
            <strong>Per day</strong> at a 30-minute interval: 48 runs × about 1.36 ℏ ≈ 65 ℏ.
          </li>
          <li>
            <strong>A failed start</strong> (reserve below the hold) still costs 0.018 ℏ, and the chain stops.
          </li>
          <li>
            <strong>The gas limit sets the hold, the work sets the charge.</strong> Lowering the gas limit shrinks the
            hold but not the charge, and it must stay above 1,600,000. Each extra position checked costs about 20–30k
            gas.
          </li>
          <li>
            <strong>Gas price moves.</strong> It was 82 tinybar/gas in a probe and 84 at the final deploy&apos;s first
            tick. Every tick records it; the market&apos;s owner can correct it with <Code>setGasPrice</Code> before the
            first tick or while the chain is stopped.
          </li>
        </ul>
      </Prose>

      <H2>runsLeft and canPayNextRun</H2>
      <Table
        head={["View", "Returns"]}
        rows={[
          [<Code key="e">runCostEstimate()</Code>, "gasLimit × gasPrice, in tinybars: the hold for one run"],
          [
            <Code key="r">runsLeft()</Code>,
            "Reserve ÷ runCostEstimate(). Counts each run at the full hold, so it never overstates.",
          ],
          [
            <Code key="c">canPayNextRun()</Code>,
            "False when the reserve can't cover the next hold: Hedera would refuse to start the run.",
          ],
        ]}
      />
      <Prose>
        <p>
          The testnet reserve started at 36 ℏ: <Code>runsLeft()</Code> said 14, but at about 1.36 ℏ actually charged it
          lasts about 25 runs, roughly 12 hours.
        </p>
      </Prose>

      <H2>Fund and revive</H2>
      <Table
        head={["Call", "Who, when", "What it does"]}
        rows={[
          [
            <Code key="f">fund()</Code>,
            "Anyone, any time",
            "Adds HBAR to the reserve. Sending HBAR to the market does the same. The reserve can only pay for scheduled runs; nobody can withdraw it.",
          ],
          [
            <Code key="r">revive()</Code>,
            "Anyone, only when nothing is booked or the booked tick is more than 2 × interval overdue (1 hour on the testnet deploy)",
            "Books a new tick one interval from now. Otherwise it reverts ScheduledKeeper__NotOverdue.",
          ],
        ]}
      />
      <Prose>
        <p>
          A failed run breaks the chain silently, because nothing books the next one. If the reserve was the cause,{" "}
          <Code>fund()</Code> first, then <Code>revive()</Code>; the /keeper page tells you to top up before reviving.
          From the command line, <Code>yarn custos:revive:testnet</Code> runs the revive.
        </p>
        <p>
          The first tick of the live deploy was booked with <Code>revive()</Code> (
          <HashScan kind="transaction" id="0xa1b7d249013f1f2812b4176ccc234f54fc0a2f0dc48270cd7f2bdd26e8fa1b71" />,
          schedule <HashScan kind="schedule" id="0.0.10833097" />
          ).
        </p>
      </Prose>

      <H2>When the price is stale</H2>
      <Prose>
        <p>
          If <Code>PriceGuard</Code> reports <Code>Stale</Code> or <Code>Deviated</Code>, the tick still runs, accrues
          funding and books the next tick, but liquidates nothing and emits <Code>SweepSkipped(status)</Code>. Refuels
          also need an <Code>Ok</Code> price. Ticks 12 to 16 on the live deploy skipped their sweep while
          Chainlink&apos;s testnet feed was hours old; tick 18 (
          <HashScan kind="transaction" id="0x963bf611a22de64c060b62a5b5267e425af1d5b4e180c9f22aa84a65b0ec8303" />) then
          liquidated the other demo position once prices recovered.
        </p>
      </Prose>

      <H2>The HCS audit log</H2>
      <Figure
        src="/docs/shot-keeper-hcs.png"
        alt="The Audit log on HCS panel: each keeper event with its run number, time and a link to its transaction, including the tick-18 liquidation by the network"
        caption="The Audit log on HCS panel on /keeper, read from topic 0.0.10839050"
        width={1280}
        height={800}
      />
      <Prose>
        <p>
          Every keeper event (<Code>Ticked</Code>, <Code>Swept</Code>, <Code>SweepSkipped</Code>,{" "}
          <Code>Liquidated</Code>, <Code>Refueled</Code>) is also written to Consensus Service topic{" "}
          <HashScan kind="topic" id="0.0.10839050" />. Its first 38 messages cover ticks 1 to 18: message 7 is the
          tick-4 liquidation and message 36 the tick-18 one.
        </p>
        <ul>
          <li>
            <strong>Off the critical path.</strong> Contracts can&apos;t write to HCS, so an off-chain script reads the
            events from the mirror node and submits one JSON message per event. If it stops, the network keeps ticking;
            the log just falls behind.
          </li>
          <li>
            <strong>Checkable.</strong> Each message carries the event&apos;s consensus timestamp, log index,
            transaction hash, run number and fields.
          </li>
          <li>
            <strong>Idempotent.</strong> The script reads the last logged event from the topic and starts after it. Only
            the operator&apos;s key can submit.
          </li>
        </ul>
      </Prose>
      <CodeBlock
        code={`yarn workspace @sh/foundry hcs-log            # or: yarn custos:hcs-log:testnet
yarn workspace @sh/foundry hcs-log --create   # once: make the topic, record it as hcsTopic
yarn workspace @sh/foundry hcs-log --dry-run  # rebuild the log from the chain, no keys`}
      />
      <Prose>
        <p>
          The operator comes from <Code>HEDERA_OPERATOR_ID</Code> and <Code>HEDERA_OPERATOR_KEY</Code> in the
          environment. Creating the topic costs about $0.01 and each message about $0.0001.
        </p>
      </Prose>

      <H2>Honest limits</H2>
      <Prose>
        <ul>
          <li>
            <strong>Testnet refuels fail closed.</strong> SaucerSwap&apos;s testnet USDC pool is about 22x off the
            oracle, so the 3% band refuses the swap and not one micro-USDC leaves the pool. The testnet reserve is
            topped up with <Code>fund()</Code>.
          </li>
          <li>
            <strong>The keeper costs real HBAR</strong>, about 1.4 ℏ a run. When the reserve can&apos;t cover the next
            hold, the chain stops until someone funds and revives it.
          </li>
          <li>
            <strong>The reserve can&apos;t be withdrawn.</strong> Redeploying leaves the old reserve behind.
          </li>
          <li>
            <strong>Liquidations wait for the next tick.</strong> A slower interval means underwater positions wait
            longer. Anyone can liquidate in between for the 0.5% reward.
          </li>
        </ul>
      </Prose>
      <Callout title="Reuse the keeper">
        <p>
          <Code>ScheduledKeeper</Code> runs any job on a timer. See{" "}
          <Link href="/docs/integrate/keeper-jobs">Write your own keeper job</Link>.
        </p>
      </Callout>
    </Doc>
  );
}
