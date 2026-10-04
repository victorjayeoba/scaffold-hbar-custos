import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, Figure, H2, HashScan, Prose, Step, Steps, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Trade",
  description:
    "Open a long or short on HBAR-USD with USDC or HBAR, track the liquidation price, and close to USDC or HBAR.",
});

export default function TradingGuide() {
  return (
    <Doc
      href="/docs/guides/trading"
      section="Using the app"
      title="Trade"
      lead="The /trade page opens a long or short on HBAR-USD with 1x to 50x leverage, paid in USDC or in HBAR through SaucerSwap. It shows your liquidation price while the position is open, and closes it to USDC or HBAR."
    >
      <Figure
        src="/docs/shot-trade.png"
        alt="The trade page: the HBAR-USD mark price, the open form with direction, pay-with and leverage, and the open positions table"
        caption="/trade on the live testnet deployment"
        width={1280}
        height={800}
      />

      <H2>Before you open</H2>
      <Prose>
        <p>
          The header shows the <strong>HBAR-USD mark price</strong> (Chainlink HBAR/USD through <Code>PriceGuard</Code>,
          the exact price the contract trades at), the <strong>Supra check (HBAR/USDT)</strong>, the price ages, funding
          and open interest, and a status:
        </p>
        <ul>
          <li>
            <strong>Open</strong>: both feeds are fresh and close enough. You can open, close and add collateral.
          </li>
          <li>
            <strong>Open, but a price is getting old</strong>: still open, with a countdown to close-only.
          </li>
          <li>
            <strong>Close-only</strong>: a price is out of date, or the two prices disagree. See{" "}
            <a href="#close-only-mode">Close-only mode</a>.
          </li>
        </ul>
        <p>
          USDC on Hedera is a Token Service token (testnet: <HashScan kind="token" id="0.0.5449" />
          ). Your account must be associated with it before the market can pay you. The form shows the steps it needs:{" "}
          <strong>Associate USDC</strong>, <strong>Approve</strong> (USDC only), then <strong>Open</strong> or{" "}
          <strong>Swap and open</strong>. If your account associates automatically, the first step is already done.
        </p>
      </Prose>

      <H2>Open a position</H2>
      <Steps>
        <Step title="Pick a direction">
          <p>
            <strong>Long</strong> profits if HBAR rises; <strong>Short</strong> profits if it falls. Each account holds
            one position at a time.
          </p>
        </Step>
        <Step title="Pick what you pay with">
          <p>
            <strong>USDC</strong> calls <Code>open(isLong, collateral, leverage)</Code>.{" "}
            <strong>HBAR via SaucerSwap</strong> calls <Code>openWithHbar(isLong, leverage, minCollateral)</Code>: the
            market swaps your HBAR to USDC on SaucerSwap and opens in the same transaction. Pick the{" "}
            <strong>Slippage you accept</strong> (0.5%, 1% or 2%); if the swap would return less, nothing happens.
          </p>
        </Step>
        <Step title="Set the amount and leverage">
          <p>
            Collateral times leverage is the position&apos;s notional. The presets are 2x, 5x, 10x, 25x and 50x, and you
            can type an exact value from 1 to 50. The 0.1% opening fee is taken from your collateral and goes to the
            pool.
          </p>
        </Step>
        <Step title="Read the preview">
          <p>
            Before you sign, the form shows the <strong>Entry price</strong>, <strong>Liquidation price</strong>,{" "}
            <strong>Funding after you open</strong> and the <strong>Room under the cap</strong>. The preview works
            without a wallet.
          </p>
        </Step>
      </Steps>

      <Table
        head={["Rule", "Value", "Error if broken"]}
        rows={[
          ["Leverage", "1x to 50x", <Code key="l">PerpMarket__InvalidLeverage</Code>],
          [
            "Minimum collateral",
            "1 USDC on the testnet deploy (after the swap, for HBAR)",
            <Code key="c">PerpMarket__BelowMinCollateral</Code>,
          ],
          ["Open fee", "0.1% of notional, from the collateral", "—"],
          [
            "Open interest cap",
            "All open positions together use at most 50% of the pool's USDC",
            <Code key="o">PerpMarket__OpenInterestCap</Code>,
          ],
          ["One position per account", "Close first to open another", <Code key="p">PerpMarket__PositionExists</Code>],
          ["Price", "Opens need an Ok price", <Code key="g">PriceGuard__NotOk</Code>],
        ]}
      />
      <Prose>
        <p>
          On chain: a 50x long opened with 1 ℏ (
          <HashScan kind="transaction" id="0x62868b097e839fdeeef472c7fd8ff26f58a3ddd410924b825f2855d75e3986e7" />) and a
          50x short opened with 1.2 USDC (
          <HashScan kind="transaction" id="0xfac6b7ecccee1f124fd9eb56be2f9657a8457dee24ccef923c2f434abbb7bdba" />
          ).
        </p>
      </Prose>
      <Callout type="warning" title="SaucerSwap's testnet pool is far off the oracle">
        <p>
          On testnet, 1 HBAR buys about 2.249 USDC on SaucerSwap while Chainlink said $0.1025, so paying with HBAR gets
          you far more collateral than the oracle value. The form warns when the two are more than 5% apart. On mainnet
          they track closely.
        </p>
      </Callout>

      <H2>Your liquidation price</H2>
      <Prose>
        <p>
          A position is liquidated when its equity (collateral + PnL − funding owed, with the gain capped at the entry
          notional) falls below its maintenance margin, 1% of notional. The liquidation price is where that happens:
        </p>
      </Prose>
      <CodeBlock
        lang="text"
        title="liquidation price"
        code={`buffer    = collateral − funding owed − 1% of notional
liq price = entry price − buffer / size        (size < 0 for a short)

10 USDC at 10x long:  notional 100, fee 0.10, collateral 9.90, margin 1.00
                      buffer 8.90 → liquidated about 8.9% below entry
1 USDC at 50x long:   notional 50, fee 0.05, collateral 0.95, margin 0.50
                      buffer 0.45 → liquidated about 0.9% below entry`}
      />
      <Prose>
        <ul>
          <li>
            <strong>Funding moves it.</strong> Funding you owe shrinks the buffer and pulls the liquidation price toward
            the mark; funding owed to you pushes it away.
          </li>
          <li>
            <strong>Add collateral moves it away.</strong> <Code>addCollateral(amount)</Code> works any time, even in
            close-only mode.
          </li>
          <li>
            <strong>Who liquidates.</strong> The network checks every position at each tick (every 30 minutes on the
            testnet deploy) and liquidates for no reward. Anyone may liquidate earlier with{" "}
            <Code>liquidate(trader)</Code> at an <Code>Ok</Code> price, for 0.5% of notional.
          </li>
          <li>
            <strong>What you lose.</strong> All remaining collateral goes to the pool, including any equity left above
            zero.
          </li>
        </ul>
        <p>
          Your position card shows <strong>Margin left before liquidation</strong> as a bar. The{" "}
          <strong>Open positions on this market</strong> table lists every position with its{" "}
          <strong>Liquidates at</strong> and <strong>Distance</strong>.
        </p>
      </Prose>

      <H2>Funding</H2>
      <Prose>
        <p>
          Funding is 0.1% of notional per hour, scaled by the long/short skew over the pool&apos;s USDC. When longs
          outweigh shorts, longs pay and shorts earn, and the reverse. The net goes to the pool. It accrues every second
          and is settled when you close: the position card shows it as{" "}
          <strong>You owe this; it&apos;s taken when you close</strong> or <strong>Owed to you</strong>.
        </p>
      </Prose>

      <H2>Close a position</H2>
      <Prose>
        <p>
          A position must stay open at least 300 seconds; until then the button reads{" "}
          <strong>Close allowed in …</strong>. You receive your equity minus the 0.1% closing fee. Profit above your
          collateral is paid by the pool.
        </p>
      </Prose>
      <Table
        head={["Receive", "Calls", "What happens"]}
        rows={[
          ["USDC", <Code key="c">close()</Code>, "The payout lands in your account in USDC."],
          [
            "HBAR via SaucerSwap",
            <Code key="h">closeToHbar(minHbarOut)</Code>,
            "The market swaps the USDC payout to HBAR on SaucerSwap in the same transaction. The app accepts up to 1% slippage.",
          ],
        ]}
      />
      <Prose>
        <p>
          On chain: a close to USDC (
          <HashScan kind="transaction" id="0xbaa65216cdb2988c3164ae25193927e622255133d6866d3c46605d6f83c61df6" />) and a
          close to HBAR (
          <HashScan kind="transaction" id="0x1e427e54abd7594d815afa933b1dbacb31ec45ca6f5133f9b416801117d91c36" />
          ). A close to USDC pays you in USDC, so your account must be associated with it first (the app offers{" "}
          <strong>Associate USDC</strong>). A close to HBAR needs no association: the USDC settles to the market, which
          swaps it and sends you HBAR.
        </p>
      </Prose>

      <H2>Close-only mode</H2>
      <Prose>
        <p>
          When <Code>PriceGuard</Code> reports <Code>Stale</Code> or <Code>Deviated</Code>, the market is close-only:
          new positions can&apos;t open, manual liquidations are refused, and the network skips its sweep. You can still
          close and add collateral. The close price is chosen by <Code>closePrice(trader)</Code>:
        </p>
        <ol>
          <li>
            At an <Code>Ok</Code> price: Chainlink.
          </li>
          <li>
            Otherwise: the worse price for you among the feeds that are still fresh. A long gets the lower one, a short
            the higher one. If only one feed is fresh, that one.
          </li>
          <li>
            If no feed is fresh: no close. The button reads <strong>Waiting for a price feed to answer</strong> and the
            contract reverts <Code>PerpMarket__NoPrice</Code>.
          </li>
        </ol>
      </Prose>
      <Callout type="warning" title="The live testnet deploy predates the fresh-feed fix">
        <p>
          The contracts deployed on 2026-10-02 still use the other feed without checking its age when one feed is down,
          so a close could settle at an old price. The source settles only at a feed younger than{" "}
          <Code>maxStaleness</Code>, and a new deploy from it has the fix. The exposure on testnet is capped by each
          position&apos;s gain cap. See the honest limits in <Code>packages/foundry/CONTRACTS_NOTES.md</Code>.
        </p>
      </Callout>

      <H2>When something fails</H2>
      <Prose>
        <p>
          Every revert has a named error. <Link href="/docs/troubleshooting">Troubleshooting</Link> lists each one with
          its fix, and <Link href="/docs/testnet">Testnet proof</Link> has a HashScan link for every trading flow.
        </p>
      </Prose>
    </Doc>
  );
}
