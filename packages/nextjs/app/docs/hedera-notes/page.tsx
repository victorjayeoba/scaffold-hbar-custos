import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, H2, H3, HashScan, Prose, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Learned on Hedera",
  description: "What testnet taught us about the Schedule Service, gas, oracles, SaucerSwap and the Token Service.",
});

export default function HederaNotes() {
  return (
    <Doc
      href="/docs/hedera-notes"
      section="Reference"
      title="Learned on Hedera"
      lead="Fourteen things Hedera testnet taught us while building Custos. Each one was hit or measured on testnet, and each one is handled in the code."
    >
      <H2>The Schedule Service (HIP-1215)</H2>

      <H3>1. A scheduled call runs as the contract itself</H3>
      <Prose>
        <p>
          When the Schedule Service executes a call the contract booked, <Code>msg.sender</Code> <strong>and</strong>{" "}
          <Code>tx.origin</Code> are the contract&apos;s own address. Probed with a throwaway contract,{" "}
          <HashScan kind="contract" id="0xd603925b9c9F91ce5D4b48C55834a46730a6143b" />.
        </p>
        <p>
          <strong>What the code does:</strong> <Code>tick()</Code> accepts only <Code>msg.sender == address(this)</Code>
          . Nobody can tick early, starve it of gas, or make the booked run revert, and{" "}
          <Code>Liquidated.byNetwork</Code> is exact.
        </p>
      </Prose>
      <Callout type="warning" title="Don't trust the mirror node's from">
        <p>
          For a scheduled run, the mirror node&apos;s <Code>from</Code> shows the JSON-RPC relay&apos;s operator
          account, not the contract. Don&apos;t rely on it.
        </p>
      </Callout>

      <H3>2. Hedera holds the whole gas limit up front</H3>
      <Prose>
        <p>
          A scheduled run only starts if the payer holds <Code>gasLimit × gasPrice</Code>. Proven: a 5,000,000-gas call
          on a contract holding 3.6 ℏ failed with <Code>INSUFFICIENT_PAYER_BALANCE</Code> (it needed 5M × 82 = 4.1 ℏ),
          even though the run itself would have cost far less (schedule <HashScan kind="schedule" id="0.0.10832561" />
          ). <strong>The failed attempt still cost 0.018 ℏ.</strong>
        </p>
        <p>
          The first Custos deploy broke this way: 5.02 ℏ in the reserve, a 6M-gas run at 85 tinybar needing 5.10 ℏ, and
          a <Code>runsLeft()</Code> that still said 3.
        </p>
        <p>
          <strong>What the code does:</strong> <Code>runCostEstimate()</Code> = <Code>gasLimit × gasPrice</Code>,{" "}
          <Code>runsLeft()</Code> counts full holds, <Code>canPayNextRun()</Code> says whether the next run can start,
          and the default gas limit dropped from 6M to 3M.
        </p>
      </Prose>

      <H3>3. tx.gasprice in a scheduled run is the network gas price, and it moves</H3>
      <Prose>
        <p>
          Inside a scheduled run <Code>tx.gasprice</Code> is the network gas price in tinybars: 82 in the probe (
          <HashScan kind="contract" id="0x2B8ac8aC37764617b96D940141A6f8f5f19b6d8e" />, 2026-10-02), 84 at the final
          deploy&apos;s first tick an hour later. It tracks Hedera&apos;s USD-denominated gas fee against the HBAR rate.
        </p>
        <p>
          <strong>What the code does:</strong> every tick records it, so the run-cost estimate follows the real price.
          Values above 1,000,000 are ignored as nonsense.
        </p>
      </Prose>

      <H3>4. Booking a schedule costs about 1.41M gas</H3>
      <Prose>
        <p>Whatever gas limit it books (measured with 300k and 1M limits). An 800k total fails.</p>
        <p>
          <strong>What the code does:</strong> the keeper holds back 1.6M gas from <Code>_work()</Code> so booking the
          next tick always fits, and rejects gas limits at or below that.
        </p>
      </Prose>

      <H3>5. block.timestamp is the start of a 2 s block</H3>
      <Prose>
        <p>
          <Code>block.timestamp</Code> is the start of Hedera&apos;s ~2 s block. A schedule that fired at its exact
          second ran in a block that started a second earlier, so the first version reverted <Code>TooEarly</Code>.
        </p>
        <p>
          <strong>What the code does:</strong> <Code>tick()</Code> accepts up to 5 s early.
        </p>
      </Prose>

      <H3>6. Capacity is per second</H3>
      <Prose>
        <p>
          <strong>What the code does:</strong> <Code>hasScheduleCapacity</Code> is checked first; if the second is full
          the keeper tries the next one, up to 10 seconds. If all 10 are full or the booking fails,{" "}
          <Code>nextRunAt</Code> still moves forward and anyone can call <Code>revive()</Code> once the tick is{" "}
          <Code>2 × interval</Code> overdue.
        </p>
      </Prose>

      <H3>7. A failed run breaks the chain silently</H3>
      <Prose>
        <p>Nothing books the next run, so the chain just stops.</p>
        <p>
          <strong>What the code does:</strong> <Code>revive()</Code> (public, only when overdue), a self-call around{" "}
          <Code>_work()</Code> so a revert there still books the next tick, and <Code>canPayNextRun()</Code> for the app
          to warn early. See <Link href="/docs/guides/keeper">The keeper</Link> for funding and reviving.
        </p>
      </Prose>

      <H2>Oracles and SaucerSwap</H2>

      <H3>8. SaucerSwap testnet&apos;s USDC pool is 22x off the oracle</H3>
      <Prose>
        <p>
          1 HBAR buys 2.249 USDC there; Chainlink says $0.1025. A keeper that refuels at that pool overpays ~22x out of
          LP money. On an earlier deploy with a wide band this drained the LPs to a share price of 0.40.
        </p>
        <p>
          <strong>What the code does:</strong> the keeper&apos;s refuel must fill within 3% of the oracle price, so{" "}
          <strong>on testnet refuels fail closed</strong> (the tick still sweeps and reschedules; not one micro-USDC
          leaves the pool) and the reserve is topped up with <Code>fund()</Code>. On mainnet, where SaucerSwap tracks
          the market, refuels go through.
        </p>
      </Prose>

      <H3>9. Chainlink&apos;s testnet HBAR/USD goes hours between pushes</H3>
      <Prose>
        <p>
          Seen 6.4 h and 3.7 h apart (it updates on deviation or a long heartbeat). With a 2 h staleness window the live
          market read <Code>Stale</Code> (close-only, sweeps skipped, deposits paused) for hours on 3 Oct.
        </p>
        <p>
          <strong>What the code does:</strong> the live guard was raised to 12 h with <Code>setParams</Code> (
          <HashScan kind="transaction" id="0x51cf5b7fd2d41425ba7599b54992e4396cbc04431ea47c6c3ae3ea3e3b6745fc" />) and{" "}
          <Code>markets.json</Code> ships 43,200 s for HBAR-USD. The 5% deviation check against Supra still catches a
          wrong price.
        </p>
      </Prose>

      <H3>10. Supra&apos;s testnet feeds update at very different speeds</H3>
      <Prose>
        <p>
          HBAR/USDT (pair 75) pushes every few minutes to about hourly, and quotes USDT, so it can sit ~3% from
          Chainlink&apos;s HBAR/USD for a while. ETH/USDT (pair 19) was seen <strong>8 h</strong> old (2026-10-03).
          Pairs 0 and 1 haven&apos;t updated in months; don&apos;t use them.
        </p>
        <p>
          <strong>What the code does:</strong> deviation is 5% for HBAR-USD. A testnet ETH market needs the guard&apos;s
          maximum 1-day window (use about 1 h on mainnet); see{" "}
          <Link href="/docs/integrate/add-market">Add a market</Link>.
        </p>
      </Prose>

      <H2>The Token Service</H2>

      <H3>11. Creating an HTS token from a contract costs about 12 HBAR</H3>
      <Prose>
        <p>12.14 ℏ measured, fee plus gas.</p>
        <p>
          <strong>What the code does:</strong> <Code>createShareToken()</Code> takes it as <Code>msg.value</Code> and
          sends back what&apos;s left.
        </p>
      </Prose>

      <H3>12. An account must be associated with an HTS token before it can receive it</H3>
      <Prose>
        <p>
          <strong>What the code does:</strong> the pool associates itself with USDC (<Code>associate()</Code>); users
          associate with USDC and with cUSDC-LP through each token&apos;s HIP-719 <Code>associate()</Code>. To redeem, a
          user approves the pool on cUSDC-LP; the pool then pulls and burns the shares.
        </p>
      </Prose>

      <H2>Tooling</H2>

      <H3>13. forge script can&apos;t deploy through the JSON-RPC relay</H3>
      <Prose>
        <p>
          The relay rejects the EIP-1898 block parameter Foundry sends when forking, and <Code>forge script</Code>{" "}
          can&apos;t simulate HSS/HTS.
        </p>
        <p>
          <strong>What the code does:</strong> <Code>yarn custos:deploy:testnet</Code> uses <Code>forge create</Code>{" "}
          and <Code>cast send</Code>.
        </p>
      </Prose>

      <H3>14. The 24 KB contract size limit applies</H3>
      <Prose>
        <p>
          PerpMarket was 26.7 KB unoptimized and the relay rejected it as <Code>CONTRACT_EXECUTION_EXCEPTION</Code>.
        </p>
        <p>
          <strong>What the code does:</strong> the optimizer (200 runs) brings it to 17.4 KB.
        </p>
      </Prose>

      <H2>What a tick costs</H2>
      <Table
        head={["Item", "Measured"]}
        rows={[
          ["Gas limit per tick (testnet deploy)", "3,000,000"],
          ["Gas price", "82 tinybar/gas (measured inside a scheduled run)"],
          [
            <strong key="h">Held up front per run</strong>,
            <span key="hv">
              <strong>2.46 ℏ</strong>: the reserve must hold at least this or Hedera won&apos;t start the run
            </span>,
          ],
          [
            <strong key="c">Charged per run</strong>,
            <span key="cv">
              <strong>Gas used × gas price</strong>, not the limit. Final deploy, ticks 1–3 (funding + a 2-position
              sweep + booking the next tick): 1.58–1.62M gas, <strong>1.31–1.36 ℏ</strong>. Tick 4, which also{" "}
              <strong>liquidated</strong> a position: 2,385,537 gas, <strong>1.98 ℏ</strong>, still inside the 3M limit.
            </span>,
          ],
          [
            "Failed start (reserve too low)",
            <span key="f">
              0.018 ℏ, and the chain stops until <Code>fund()</Code> + <Code>revive()</Code>
            </span>,
          ],
          ["Per day at a 30 min interval", "48 runs × ~1.36 ℏ ≈ 65 ℏ charged"],
          [
            "Testnet reserve at deploy",
            <span key="r">
              36 ℏ: <Code>runsLeft()</Code> says 14 (each counted at the full 2.46 ℏ hold); at ~1.36 ℏ actually charged
              it lasts ~25 runs, ~12 h
            </span>,
          ],
        ]}
      />
      <Prose>
        <p>
          So the gas limit decides how much HBAR must sit in the reserve, and the work actually done decides what each
          run costs. To run longer: fund more (<Code>fund()</Code> on the market, or send HBAR to it), or lengthen the
          interval. Lowering the gas limit shrinks the hold but not the charge (it must stay above 1.6M, and each extra
          position checked costs about 20–30k gas).
        </p>
      </Prose>
    </Doc>
  );
}
