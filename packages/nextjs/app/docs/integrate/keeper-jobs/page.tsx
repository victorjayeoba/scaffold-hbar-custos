import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, H2, H3, HashScan, Prose, Step, Steps, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Write your own keeper job",
  description: "Reuse ScheduledKeeper for anything on a timer: interest, expiries, payouts, or a lending market.",
});

const HEARTBEAT = `
contract Heartbeat is ScheduledKeeper {
    uint256 public immutable maxBeats;
    uint256 public beats;

    event Beat(uint256 indexed beat, uint256 at);

    constructor(uint256 interval_, uint256 gasLimit_, uint256 gasPrice_, uint256 maxBeats_)
        ScheduledKeeper(interval_, gasLimit_, gasPrice_)
    {
        maxBeats = maxBeats_;
    }

    function _work() internal override {
        emit Beat(++beats, block.timestamp);
    }

    function _keepGoing() internal view override returns (bool) {
        return maxBeats == 0 || runCount < maxBeats;
    }
}
`;

const MY_JOB = `
import { ScheduledKeeper } from "./ScheduledKeeper.sol";

contract MyJob is ScheduledKeeper {
    // every 10 min, 2M gas, 82 tinybar/gas to start
    constructor() ScheduledKeeper(600, 2_000_000, 82) {}

    function _work() internal override {
        // the job: a revert here is caught, the next tick is still booked
    }

    function _keepGoing() internal view override returns (bool) {
        return true; // false ends the chain
    }
}
`;

const DEPLOY = `
forge create contracts/MyJob.sol:MyJob --rpc-url https://testnet.hashio.io/api --account <keystore> --legacy --broadcast
cast send <address> "fund()" --value 10ether --rpc-url https://testnet.hashio.io/api --account <keystore> --legacy
cast send <address> "revive()" --gas-limit 2500000 --rpc-url https://testnet.hashio.io/api --account <keystore> --legacy
`;

const LENDING = `
contract LendingMarket is ScheduledKeeper {
    PriceGuard public immutable guard;
    mapping(address => Loan) internal loans;
    address[] internal borrowers;

    constructor(PriceGuard guard_) ScheduledKeeper(3600, 3_000_000, 82) { guard = guard_; }

    function _work() internal override {
        (uint256 price, PriceGuard.Status status,,,) = guard.read();
        _accrueInterest();                          // the network charges interest every hour
        if (status != PriceGuard.Status.Ok) return; // never liquidate at a bad price
        // page through \`borrowers\` like PerpMarket._sweep, liquidating loans under their health factor
    }
}
`;

export default function KeeperJobs() {
  return (
    <Doc
      href="/docs/integrate/keeper-jobs"
      section="Build with Custos"
      title="Write your own keeper job"
      lead="ScheduledKeeper is the part of Custos that has nothing to do with perps: inherit it, override _work(), fund it with HBAR, and the Hedera Schedule Service runs your job every interval with no bot. Each run books the next one."
    >
      <H2>How it runs</H2>
      <Prose>
        <ol>
          <li>
            <Code>revive()</Code> books the first <Code>tick()</Code> on the Schedule Service, <Code>interval</Code>{" "}
            seconds out.
          </li>
          <li>
            At that second the network calls <Code>tick()</Code>. The call runs as the contract itself, so{" "}
            <Code>tick()</Code> accepts only <Code>msg.sender == address(this)</Code>: nobody else can tick early or
            starve it of gas.
          </li>
          <li>
            <Code>tick()</Code> records the gas price, runs <Code>_work()</Code> in a self-call (a revert there is
            caught and reported in <Code>Ticked</Code>), then books the next tick if <Code>_keepGoing()</Code> says so.
          </li>
          <li>The contract pays for each run from its own HBAR balance.</li>
        </ol>
      </Prose>

      <H2>The ScheduledKeeper API</H2>
      <H3>What you implement</H3>
      <Table
        head={["Member", "What it is"]}
        rows={[
          [
            <Code key="c">constructor(uint256 interval_, uint256 gasLimit_, uint256 gasPrice_)</Code>,
            "Seconds between ticks; gas each tick is booked with (must exceed 1,600,000); starting gas price in tinybars per gas (ticks then record the real one)",
          ],
          [<Code key="w">function _work() internal virtual</Code>, "The job. Required. Reverting is safe"],
          [
            <Code key="k">function _keepGoing() internal view virtual returns (bool)</Code>,
            "Return false to stop after this tick. Default: run forever",
          ],
        ]}
      />
      <H3>What you get</H3>
      <Table
        head={["Function", "What it does"]}
        rows={[
          [<Code key="f">tick()</Code>, "Network only. Runs the job and books the next tick"],
          [
            <Code key="f">revive()</Code>,
            "Anyone. Books the first tick, or restarts a chain more than 2 × interval overdue",
          ],
          [<Code key="f">fund() payable</Code>, "Tops up the HBAR reserve; a plain HBAR transfer works too"],
          [<Code key="f">runCostEstimate()</Code>, "gasLimit × gasPrice, tinybars: what Hedera holds before each run"],
          [<Code key="f">runsLeft()</Code>, "Balance / runCostEstimate(): runs the reserve covers at the full hold"],
          [<Code key="f">canPayNextRun()</Code>, "False when Hedera would refuse to start the next run"],
          [
            <Code key="f">nextRunAt() / lastRunAt() / runCount() / nextSchedule()</Code>,
            "The schedule: unix seconds, run count, schedule address",
          ],
          [
            <Code key="f">interval() / gasLimit() / gasPrice()</Code>,
            "Immutable settings; the last recorded gas price",
          ],
        ]}
      />
      <H3>Constants</H3>
      <Table
        head={["Constant", "Value", "Why"]}
        rows={[
          [
            <Code key="c">SCHEDULE_GAS_RESERVE</Code>,
            "1,600,000",
            "Gas held back from _work() so booking the next tick always fits (scheduleCall costs about 1.41M)",
          ],
          [
            <Code key="c">TIMESTAMP_TOLERANCE</Code>,
            "5 s",
            "block.timestamp is the start of Hedera's ~2 s block, so a run can look a second or two early",
          ],
          [<Code key="c">CAPACITY_PROBES</Code>, "10", "If a second is full, try the next one, up to 10 seconds"],
          [<Code key="c">MAX_GAS_PRICE</Code>, "1,000,000", "Gas prices above this (tinybars per gas) are ignored"],
        ]}
      />

      <H2>Start from Heartbeat</H2>
      <Prose>
        <p>
          <Code>packages/foundry/contracts/examples/Heartbeat.sol</Code> is the smallest keeper: it counts its own beats
          and stops after <Code>maxBeats</Code> (0 runs forever). One ran three times on testnet, 60 s apart, each run
          booked by the one before (<HashScan kind="contract" id="0.0.10776628" />
          ).
        </p>
      </Prose>
      <CodeBlock lang="solidity" title="examples/Heartbeat.sol" code={HEARTBEAT} />

      <H2>A minimal job</H2>
      <CodeBlock lang="solidity" title="contracts/MyJob.sol" code={MY_JOB} />
      <Prose>
        <p>
          To add work to the perp market itself instead, extend <Code>PerpMarket._work()</Code>; it already accrues
          funding, sweeps and refuels.
        </p>
      </Prose>

      <H2>Deploy and book the first tick</H2>
      <Steps>
        <Step title="Deploy, fund, revive">
          <CodeBlock code={DEPLOY} />
          <p>
            The same tools <Code>custos.js</Code> uses: <Code>forge create</Code> and <Code>cast send</Code> with legacy
            transactions (<Code>forge script</Code> can&apos;t deploy through the Hedera relay).{" "}
            <Code>--value 10ether</Code> sends 10 HBAR. <Code>revive()</Code> needs a high gas limit because it books a
            schedule.
          </p>
        </Step>
        <Step title="Watch it run">
          <p>
            The schedule <Code>revive()</Code> booked appears on HashScan (<Code>nextSchedule()</Code> is its address).
            After <Code>interval</Code> seconds it executes, emits <Code>Ticked</Code>, and the next schedule appears.
            If the chain ever stops (empty reserve, no capacity), <Code>fund()</Code> it and call <Code>revive()</Code>{" "}
            once it is overdue.
          </p>
        </Step>
      </Steps>
      <Callout type="tip" title="Test it the way the network runs it">
        <p>
          In Foundry, prank as the contract itself before calling <Code>tick()</Code>, as <Code>CustosBase._tick</Code>{" "}
          does. <Code>ScheduledKeeper.t.sol</Code> has the pattern, including a reverting job that still books the next
          tick.
        </p>
      </Callout>

      <H2>Gas budgeting</H2>
      <Prose>
        <p>Two numbers decide whether a run starts and what it costs:</p>
        <ul>
          <li>
            <strong>The hold.</strong> Hedera starts a scheduled run only if the payer holds the whole{" "}
            <Code>gasLimit × gasPrice</Code>. At 3,000,000 gas and 82 tinybar/gas that is 2.46 ℏ. A run that can&apos;t
            be held fails with <Code>INSUFFICIENT_PAYER_BALANCE</Code>, still costs about 0.018 ℏ, and stops the chain.{" "}
            <Code>runsLeft()</Code> counts full holds, so it never overstates.
          </li>
          <li>
            <strong>The charge.</strong> Hedera then charges only the gas the run used. A Custos tick that sweeps a
            small book and books the next one uses about 1.6M gas, about 1.36 ℏ.
          </li>
          <li>
            <strong>The work budget.</strong> <Code>_work()</Code> gets what is left after{" "}
            <Code>SCHEDULE_GAS_RESERVE</Code>: keep it under <Code>gasLimit − 1,600,000</Code>. A job that runs over
            reverts (caught; the next tick is still booked) and does nothing. For a big list, page through it with a
            cursor and a gas floor, as <Code>PerpMarket._sweep</Code> does.
          </li>
        </ul>
        <p>
          A lower gas limit shrinks the hold but not the charge. More HBAR in the reserve, or a longer interval, makes
          it last longer. The keeper&apos;s HBAR can&apos;t be withdrawn: it only pays for runs.
        </p>
      </Prose>

      <H2>Sketch: a lending market</H2>
      <Prose>
        <p>
          Keep <Code>ScheduledKeeper</Code> and <Code>PriceGuard</Code> and write the loan book. This is a sketch, not a
          contract in the repo: <Code>Loan</Code> and <Code>_accrueInterest</Code> are yours to write.
        </p>
      </Prose>
      <CodeBlock lang="solidity" title="sketch" code={LENDING} />
      <Prose>
        <ul>
          <li>
            Copy <Code>PerpMarket._sweep</Code> for paging, so a big book spreads over several ticks.
          </li>
          <li>
            Copy <Code>LiquidityPool.createShareToken</Code> and its <Code>_mint</Code> / <Code>_burn</Code> /{" "}
            <Code>_send</Code> if lenders should hold a real HTS token, and its value-before-deposit logic (
            <Code>_syncMarket</Code>) to stop deposit/withdraw sandwiches.
          </li>
        </ul>
      </Prose>

      <H2>Changing the interval</H2>
      <Prose>
        <p>
          <Code>interval</Code> is <Code>immutable</Code>: set it at deploy. For the perp market:
        </p>
      </Prose>
      <CodeBlock code="KEEPER_INTERVAL=3600 yarn custos:deploy:testnet" />
      <Prose>
        <ul>
          <li>
            <strong>Cost:</strong> each run is charged for the gas it uses, so halving the interval roughly doubles the
            HBAR spent: about 65 ℏ a day at 30 minutes.
          </li>
          <li>
            <strong>Safety:</strong> at 50x a ~2% move wipes a position. A slower interval leaves underwater positions
            waiting longer; manual liquidators can still call <Code>liquidate()</Code> at any time for the 0.5% reward.
          </li>
          <li>
            <strong>Funding</strong> accrues continuously; the interval only decides when it is booked.
          </li>
        </ul>
        <p>
          <Code>KEEPER_GAS_LIMIT</Code> and <Code>KEEPER_GAS_PRICE</Code> set the other two constructor arguments the
          same way. More on costs and reviving in <Link href="/docs/guides/keeper">The keeper</Link>.
        </p>
      </Prose>
    </Doc>
  );
}
