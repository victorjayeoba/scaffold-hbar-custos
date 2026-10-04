import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, H2, H3, HashScan, Prose, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Testnet proof",
  description:
    "The live Custos deployment on Hedera testnet, a HashScan link for every flow, and liquidations nobody signed.",
});

const tx = (id: string) => <HashScan kind="transaction" id={id} />;
const schedule = (id: string) => <HashScan kind="schedule" id={id} />;
const contract = (id: string) => <HashScan kind="contract" id={id} />;
const code = (text: string) => <Code>{text}</Code>;

export default function TestnetProof() {
  return (
    <Doc
      href="/docs/testnet"
      section="Reference"
      title="Testnet proof"
      lead="Everything on this page can be checked on HashScan. The addresses are also in packages/foundry/deployments/296.json; the full record is packages/foundry/TESTNET.md."
    >
      <Callout type="tip" title="Two liquidations nobody signed">
        <p>
          On the final deploy the Schedule Service executed tick 4 (
          {tx("0x7c37d2a7399f66bc85fe549a12766212d8622ed0a31911959c204e588dde59a9")}) and tick 18 (
          {tx("0x963bf611a22de64c060b62a5b5267e425af1d5b4e180c9f22aa84a65b0ec8303")}), each from a schedule the previous
          tick booked, and each liquidated a 50x demo position: <Code>byNetwork = true</Code>, <Code>reward = 0</Code>,
          all collateral to the pool.
        </p>
      </Callout>

      <H2>Deployment</H2>
      <Prose>
        <p>The final deployment, 2026-10-02.</p>
      </Prose>
      <Table
        head={["Contract", "Hedera ID", "EVM address"]}
        rows={[
          ["PerpMarket (keeper)", contract("0.0.10833087"), code("0xb79Cc40A4b1d3C135f71Ed6dc4e9a231cC369b67")],
          ["LiquidityPool", contract("0.0.10833082"), code("0x06061a60D2f9E99410F1D2B310DCF51A1ff2A3b1")],
          ["PriceGuard", contract("0.0.10833074"), code("0x293e90142cc9dDF603d9Ab405B43236e8077EF75")],
          [
            "cUSDC-LP share token (HTS, created by the pool)",
            <HashScan key="t" kind="token" id="0.0.10833090" />,
            code("0x0000000000000000000000000000000000a54cc2"),
          ],
          [
            "HbarDepositZap (LPs deposit with HBAR via SaucerSwap)",
            contract("0xdD40EBFf88aaDc52B31D9E698803e47B04Ef185C"),
            code("0xdD40EBFf88aaDc52B31D9E698803e47B04Ef185C"),
          ],
          [
            "USDC (SaucerSwap testnet's)",
            <HashScan key="u" kind="token" id="0.0.5449" />,
            code("0x0000000000000000000000000000000000001549"),
          ],
          ["HCS audit log topic", <HashScan key="h" kind="topic" id="0.0.10839050" />, "—"],
        ]}
      />
      <Prose>
        <p>
          <strong>Keeper:</strong> interval 1,800 s, gas limit 3,000,000, gas price 82 tinybar/gas (2.46 ℏ held per
          run), 36 ℏ reserve. <strong>PriceGuard:</strong> Chainlink HBAR/USD checked against Supra HBAR/USDT (pair 75),
          max staleness 43,200 s (raised from 7,200 s on 3 Oct with <Code>setParams</Code>,{" "}
          {tx("0x51cf5b7fd2d41425ba7599b54992e4396cbc04431ea47c6c3ae3ea3e3b6745fc")}: Chainlink&apos;s testnet HBAR/USD
          goes hours between pushes), max deviation 500 bps. Min collateral 1 USDC. Refuel band 300 bps. Collateral:
          SaucerSwap testnet USDC 0.0.5449.
        </p>
      </Prose>

      <H2>Every flow, on chain</H2>
      <Table
        head={["Flow", "Transaction"]}
        rows={[
          [
            "Pool creates its HTS share token (cUSDC-LP)",
            tx("0xf405eadedf1ddd1e99b615a619ae451d0f5b78dd049fb8bfb84189e681340a5a"),
          ],
          [
            <>Keeper books its first tick ({code("revive")})</>,
            <>
              {tx("0xa1b7d249013f1f2812b4176ccc234f54fc0a2f0dc48270cd7f2bdd26e8fa1b71")}, schedule{" "}
              {schedule("0.0.10833097")}
            </>,
          ],
          [
            "Deposit 361.79 USDC, pool mints cUSDC-LP",
            tx("0x55d081b26535e7c9ef68664a080f0609a7caacab03becc115ee7180e1154d722"),
          ],
          [
            "Open with HBAR: 50x long, 1 ℏ swapped to USDC on SaucerSwap",
            tx("0x62868b097e839fdeeef472c7fd8ff26f58a3ddd410924b825f2855d75e3986e7"),
          ],
          [
            "Open with USDC: 50x short, 1.2 USDC",
            tx("0xfac6b7ecccee1f124fd9eb56be2f9657a8457dee24ccef923c2f434abbb7bdba"),
          ],
          ["Open with USDC: 2x long, 1 USDC", tx("0xd3f325cf8191e5e197b9af1f45a9ab90173079181724f9f331bb603726443de8")],
          ["Close, paid out in USDC", tx("0xbaa65216cdb2988c3164ae25193927e622255133d6866d3c46605d6f83c61df6")],
          [
            <>Close straight to HBAR: the USDC payout swapped on SaucerSwap ({code("closeToHbar")})</>,
            tx("0x1e427e54abd7594d815afa933b1dbacb31ec45ca6f5133f9b416801117d91c36"),
          ],
          [
            <>
              Deposit with HBAR: 0.5 ℏ swapped to 1.12 USDC on SaucerSwap and deposited for the caller (
              {code("HbarDepositZap.depositWithHbar")}), 1,114,696 cUSDC-LP minted to them
            </>,
            tx("0x3c23d3b3cdf4058d5843f06be3d66af91e35c886af53370437cb5d21636ca098"),
          ],
          [
            "Redeem 10 cUSDC-LP, pool burns the shares",
            tx("0x9048724259694f86a20fa69aa069a89d3e85045703b0a6f1a9b302d66c2d7422"),
          ],
        ]}
      />

      <H2>The network keeps the market</H2>
      <Prose>
        <p>
          Each tick is executed by the Schedule Service from a schedule the previous tick booked;{" "}
          <Code>msg.sender</Code> is the market itself, and no one signs it.
        </p>
      </Prose>
      <Table
        head={["Tick", "Executed", "What it did"]}
        rows={[
          [
            "1",
            <>
              {tx("0x5bebf1d891890489514a052be62988357a00dc621b9fa19a6fe09f80de0038f6")} (schedule{" "}
              {schedule("0.0.10833097")}, 1790983197.030564046)
            </>,
            "Accrued funding, swept the 2 open positions (none underwater), recorded the gas price it ran at (84 tinybar/gas), booked tick 2. Paid by the market itself: 1.359 ℏ for 1,618,265 gas",
          ],
          [
            "2",
            <>{tx("0x756e4e8e11bf69370a543a2d518e905c868aca2361ba606455b803140a8c518a")} (1790984996.012)</>,
            "Funding, sweep (none underwater), booked tick 3. 1.327 ℏ for 1,580,037 gas",
          ],
          [
            "3",
            <>{tx("0xcaaa44b5a61366f099f2d334c571e1d578b198357ea07dc56c350c980e38aef3")} (1790986794.024)</>,
            <>Funding, sweep (none underwater), booked tick 4. 1.315 ℏ for 1,584,087 gas</>,
          ],
          [
            "4",
            <>{tx("0x7c37d2a7399f66bc85fe549a12766212d8622ed0a31911959c204e588dde59a9")} (1790988593.014)</>,
            <>
              <strong>Liquidated</strong> the 50x short {code("0xebBA…F393")} at $0.10277 (its liquidation price was
              $0.10266): {code("Liquidated(byNetwork = true, by = 0x0, reward = 0)")}, all collateral to the pool.
              Nobody signed it. 1.980 ℏ for 2,385,537 gas
            </>,
          ],
          [
            "18",
            <>{tx("0x963bf611a22de64c060b62a5b5267e425af1d5b4e180c9f22aa84a65b0ec8303")} (1791013775.07)</>,
            <>
              <strong>Liquidated</strong> the other demo position, the 50x long {code("0xA807…6Ec6")}, at $0.10062 (its
              liquidation price was $0.10083): {code("byNetwork = true")}, {code("reward = 0")}
            </>,
          ],
        ]}
      />
      <H3>Ticks 12–16 skipped the sweep</H3>
      <Prose>
        <p>
          Ticks 12–16 ran while Chainlink&apos;s testnet feed was hours old and <strong>skipped the sweep</strong> (
          <Code>SweepSkipped(Stale)</Code>): the keeper refuses to liquidate at a stale price, exactly as designed. See{" "}
          <Link href="/docs/hedera-notes">Learned on Hedera</Link>, item 9.
        </p>
      </Prose>
      <H3>The same history on HCS</H3>
      <Prose>
        <p>
          Every keeper event is mirrored to HCS topic <HashScan kind="topic" id="0.0.10839050" /> by{" "}
          <Code>scripts-js/hcsLog.js</Code>. Its first 38 messages cover ticks 1–18: message #7 is the tick-4
          liquidation and #36 the tick-18 one.
        </p>
      </Prose>

      <H2>Source verification</H2>
      <Prose>
        <p>
          Source verified on Sourcify: LiquidityPool exact match; PerpMarket and PriceGuard match (identical bytecode,
          source reformatted after the deploy).
        </p>
      </Prose>
      <Callout type="warning" title="The live deploy predates the stale-close fix">
        <p>
          The contracts deployed on 2026-10-02 still have the old <Code>closePrice()</Code> behaviour; a new deploy from
          the current source has the fix. See <Link href="/docs/troubleshooting#honest-limits">Honest limits</Link>.
        </p>
      </Callout>

      <H2>Earlier deploy: the first liquidation nobody signed</H2>
      <Prose>
        <p>
          The first version (PerpMarket {contract("0.0.10776702")}, since retired) proved the whole loop on 2026-09-29.
          Every tick below was executed by the Schedule Service from a schedule the previous tick booked.
        </p>
      </Prose>
      <Table
        head={["Tick", "Schedule", "Executed", "What it did"]}
        rows={[
          [
            "1",
            schedule("0.0.10776713"),
            tx("1790687748.000592261"),
            "Funding accrued, swept 2 traders, none underwater",
          ],
          ["2", schedule("0.0.10777055"), tx("1790689547.018645425"), "Swept 2 traders, none underwater yet"],
          [
            "3",
            schedule("0.0.10777398"),
            tx("1790691346.057913123"),
            <>
              <strong>Liquidated</strong> the 50x long {code("0xA807…6Ec6")} at 0.11304294 (liquidation price 0.11353):{" "}
              {code("Liquidated(byNetwork = true, reward = 0)")}, all 0.1425 USDC collateral to the pool. Charged 1.755
              ℏ for 1.61M gas used of 2.5M
            </>,
          ],
        ]}
      />
      <Prose>
        <p>
          Tick 3 ran one second before its <Code>nextRunAt</Code> (Hedera&apos;s block timestamp lag), which the 5 s
          tolerance absorbs. That deploy&apos;s chain later stopped with <Code>INSUFFICIENT_PAYER_BALANCE</Code>: Hedera
          holds a run&apos;s whole gas limit up front, and its 6M-gas runs needed more than the reserve held. The final
          deploy accounts for this (<Link href="/docs/hedera-notes">Learned on Hedera</Link>, item 2).
        </p>
      </Prose>

      <H2>Probes</H2>
      <Prose>
        <p>Throwaway contracts that answered a question.</p>
      </Prose>
      <Table
        head={["Question", "Contract", "Answer"]}
        rows={[
          [
            <>Who is {code("msg.sender")} when the Schedule Service runs a booked call?</>,
            contract("0xd603925b9c9F91ce5D4b48C55834a46730a6143b"),
            <>
              The contract itself ({code("msg.sender")} and {code("tx.origin")})
            </>,
          ],
          [
            <>What is {code("tx.gasprice")} inside a scheduled run?</>,
            contract("0x2B8ac8aC37764617b96D940141A6f8f5f19b6d8e"),
            "82 (tinybars per gas)",
          ],
          [
            "Does Hedera hold the whole gas limit before a scheduled run?",
            "same",
            <>
              Yes: a 5M-gas run with 3.6 ℏ in the contract failed {code("INSUFFICIENT_PAYER_BALANCE")} (needs 4.1 ℏ),
              schedule {schedule("0.0.10832561")}; the failed attempt cost 0.018 ℏ
            </>,
          ],
        ]}
      />
    </Doc>
  );
}
