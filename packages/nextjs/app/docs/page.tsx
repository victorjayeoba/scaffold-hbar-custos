import { Doc } from "~~/components/docs/Doc";
import { Callout, Card, Cards, Code, H2, HashScan, Prose, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Docs",
  description: "Custos documentation: a margin engine the Hedera network keeps, shipped as a scaffold-hbar template.",
});

export default function DocsHome() {
  return (
    <Doc
      href="/docs"
      section="Getting started"
      title="Custos documentation"
      lead="Custos is a margin engine the Hedera network keeps: an HBAR-USD perpetual market whose liquidations and funding are run by Hedera's Schedule Service, with no keeper bot and no server. It ships as a scaffold-hbar template you can scaffold with one command."
    >
      <Prose>
        <p>
          On most chains, anything that must happen on a timer (liquidations, funding, interest, expiries) is run by an
          automation network or a team&apos;s own bot. Hedera has its own answer: since HIP-1215, a contract can book a
          call to itself in the future, and the network runs it. Custos uses that for the highest-stakes job there is,
          liquidating positions with real money on the line, and solves its sharp edges in the open: capacity, the gas
          hold, broken chains, gas limits and testing.
        </p>
      </Prose>

      <Callout type="tip" title="Pull the plug: Hedera keeps the books">
        <p>
          Every tick of the live market is executed by the Schedule Service from a schedule the previous tick booked.
          Two positions on the final testnet deploy were liquidated that way, with nobody signing: tick 4 (
          <HashScan kind="transaction" id="0x7c37d2a7399f66bc85fe549a12766212d8622ed0a31911959c204e588dde59a9" />) and
          tick 18 (
          <HashScan kind="transaction" id="0x963bf611a22de64c060b62a5b5267e425af1d5b4e180c9f22aa84a65b0ec8303" />
          ).
        </p>
      </Callout>

      <H2>What you get</H2>
      <Prose>
        <p>Three reusable parts, and a market built from them:</p>
      </Prose>
      <Table
        head={["Contract", "Job", "Reuse it for"]}
        rows={[
          [
            <Code key="k">ScheduledKeeper</Code>,
            "Runs a job every interval with no bot: each tick books the next one on the Schedule Service and pays for it.",
            "Liquidations, interest, expiries, rebalancing, payouts",
          ],
          [
            <Code key="g">PriceGuard</Code>,
            "Chainlink is the price, Supra is the cross-check. Refuses stale or disagreeing prices, never reverts on a broken feed.",
            "Anything that must not act on a bad price",
          ],
          [
            <Code key="m">MarginAccount</Code>,
            "Position book and risk math: PnL, funding, equity, maintenance margin, liquidation price.",
            "Perps, margin, leveraged positions",
          ],
          [
            <Code key="p">PerpMarket</Code>,
            "The HBAR-USD market. The network liquidates and charges funding on every tick.",
            "The demo; copy it for a new market",
          ],
          [
            <Code key="l">LiquidityPool</Code>,
            "USDC in, cUSDC-LP out: a native Hedera token the pool creates and mints. Every trader's counterparty.",
            "Any vault whose shares should be a real Hedera token",
          ],
          [
            <Code key="z">HbarDepositZap</Code>,
            "LPs deposit with HBAR: SaucerSwap swaps it to USDC and the zap deposits it, in one transaction.",
            "Any vault that should accept HBAR directly",
          ],
        ]}
      />

      <H2>Hedera services in play</H2>
      <Prose>
        <ul>
          <li>
            <strong>Schedule Service</strong>: the keeper. Every tick books the next one (HIP-1215).
          </li>
          <li>
            <strong>Token Service</strong>: USDC collateral, and the cUSDC-LP share token, created and minted by the
            pool contract.
          </li>
          <li>
            <strong>Consensus Service</strong>: an audit log of every keeper event on topic{" "}
            <HashScan kind="topic" id="0.0.10839050" />.
          </li>
          <li>
            <strong>Mirror node</strong>: the app&apos;s history, and the source the audit log is built from.
          </li>
          <li>
            <strong>Ecosystem</strong>: Chainlink and Supra prices; SaucerSwap for opening with HBAR, closing to HBAR,
            depositing HBAR, and the keeper&apos;s refuel; HashPack and Kabila wallets.
          </li>
        </ul>
      </Prose>

      <H2>Where to go next</H2>
      <Cards>
        <Card title="Quickstart" href="/docs/quickstart">
          Scaffold the template, run the tests, deploy your own market to testnet.
        </Card>
        <Card title="How it works" href="/docs/architecture">
          The contracts, and a liquidation from start to finish.
        </Card>
        <Card title="Add a market" href="/docs/integrate/add-market">
          ETH-USD, or any asset, as configuration rather than code.
        </Card>
        <Card title="Testnet proof" href="/docs/testnet">
          The live deployment and a HashScan link for every flow.
        </Card>
      </Cards>
    </Doc>
  );
}
