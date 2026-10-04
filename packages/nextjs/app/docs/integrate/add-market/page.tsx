import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, H2, HashScan, Prose, Step, Steps, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Add a market",
  description: "Add ETH-USD, or any asset, to Custos as configuration: markets.json, a test, a testnet check.",
});

const ETH_USD = `
"ETH-USD": {
  "chainlink": "0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9",
  "supra": "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917",
  "supraPair": 19,
  "maxStaleness": 86400,
  "maxDeviationBps": 500,
  "refPrice8": 270000000000
}
`;

export default function AddMarket() {
  return (
    <Doc
      href="/docs/integrate/add-market"
      section="Build with Custos"
      title="Add a market"
      lead="The engine doesn't care what asset it prices. A market is a PriceGuard config plus its own pool and market contract, so adding ETH-USD is one entry in markets.json, a test run, a live feed check and a deploy. No Solidity changes."
    >
      <H2>What a market is</H2>
      <Prose>
        <p>
          Each entry in <Code>packages/foundry/markets.json</Code> is what <Code>PriceGuard</Code> needs for one asset:
        </p>
      </Prose>
      <Table
        head={["Key", "Meaning"]}
        rows={[
          [<Code key="k">chainlink</Code>, "The Chainlink aggregator for ASSET/USD on Hedera (the price)"],
          [<Code key="k">supra</Code>, "Supra's push-oracle contract (the cross-check)"],
          [<Code key="k">supraPair</Code>, "Supra's pair index for the asset"],
          [<Code key="k">maxStaleness</Code>, "Seconds before a feed counts as Stale; at most 86,400 (1 day)"],
          [<Code key="k">maxDeviationBps</Code>, "Largest Chainlink/Supra gap allowed; at most 2,000 bps"],
          [<Code key="k">refPrice8</Code>, "A typical price with 8 decimals, used by the tests"],
        ]}
      />
      <Prose>
        <p>
          The shipped entry is <Code>HBAR-USD</Code>: Chainlink HBAR/USD, Supra pair 75, 43,200 s staleness, 500 bps.
          Leave it as it is; the app reads that market.
        </p>
      </Prose>

      <H2>The recipe: ETH-USD</H2>
      <Steps>
        <Step title="Add the entry to markets.json">
          <p>
            Next to <Code>&quot;HBAR-USD&quot;</Code> in <Code>packages/foundry/markets.json</Code>:
          </p>
          <CodeBlock lang="json" title="packages/foundry/markets.json" code={ETH_USD} />
          <p>
            Chainlink ETH/USD on Hedera testnet (8 decimals); the same Supra contract HBAR-USD uses, pair 19 (ETH/USDT).{" "}
            <Code>refPrice8</Code> is $2,700.
          </p>
        </Step>
        <Step title="Check the config offline">
          <CodeBlock code="yarn workspace @sh/foundry check-markets ETH-USD" />
          <p>
            Checks every entry against the limits <Code>PriceGuard</Code> enforces and fails if ETH-USD is missing. No
            network, no keys.
          </p>
        </Step>
        <Step title="Run the tests">
          <CodeBlock code="yarn foundry:test" />
          <p>
            <Code>test/Markets.t.sol</Code> reads <Code>markets.json</Code> and runs <strong>every</strong> market
            through a full cycle at its <Code>refPrice8</Code>: the guard accepts the config, a long and a short open,
            the network liquidates the long on a 15% drop, the short closes at a profit, and the pool&apos;s books
            balance. A new entry is covered with no new test.
          </p>
        </Step>
        <Step title="Check the live feeds on testnet">
          <CodeBlock code="yarn custos:check-market:testnet --market ETH-USD" />
          <p>
            Deploys only a <Code>PriceGuard</Code> with the ETH-USD config (a little HBAR), reads both feeds, prints the
            prices and status, and exits 1 if either feed doesn&apos;t answer. It signs with a keystore or{" "}
            <Code>DEPLOYER_PRIVATE_KEY</Code> from your shell. On 2026-10-03 it read Chainlink 2,657.85 and Supra
            2,702.77 (PriceGuard <HashScan kind="contract" id="0x1eD9de819a144d7b6C80102Ff5FA83180151949D" />
            ).
          </p>
        </Step>
        <Step title="Deploy it">
          <CodeBlock
            code={`yarn custos:deploy:testnet --market ETH-USD
yarn custos:start:testnet --market ETH-USD`}
          />
          <p>
            Deploys a PriceGuard, pool and market for ETH-USD, then books its keeper&apos;s first tick.{" "}
            <Code>custos:demo:testnet</Code> takes the same flag. The addresses go to{" "}
            <Code>packages/foundry/deployments/296-eth-usd.json</Code>; <Code>deployedContracts.ts</Code> is left alone,
            so the app keeps showing HBAR-USD.
          </p>
        </Step>
      </Steps>

      <H2>Choosing the staleness window</H2>
      <Prose>
        <p>
          <Code>maxStaleness</Code> must be longer than the slowest feed&apos;s gap between updates, or the market reads{" "}
          <Code>Stale</Code>: close-only, sweeps skipped, pool deposits paused. Push oracles update on deviation or on a
          heartbeat, and on testnet they push rarely.
        </p>
        <ul>
          <li>
            Supra&apos;s testnet ETH/USDT was seen <strong>8 hours</strong> old, so testnet ETH-USD needs the
            guard&apos;s maximum, 86,400 s.
          </li>
          <li>On mainnet, where feeds update far more often, use about 3,600 s.</li>
          <li>
            The 500 bps deviation check against Supra still catches a wrong price inside a long window. Supra quotes
            USDT, so leave room for a small gap from Chainlink&apos;s USD price.
          </li>
          <li>Supra pairs 0 and 1 haven&apos;t updated on testnet in months; don&apos;t use them.</li>
        </ul>
      </Prose>
      <Callout type="info" title="One market per deployment">
        <p>
          Each market is its own PriceGuard, pool, market and keeper reserve. The app is HBAR-USD only: it reads{" "}
          <Code>deployedContracts.ts</Code>, which holds the default market&apos;s contracts (the price panel reads its
          Supra pair and limits from that market&apos;s PriceGuard). Showing a second market in the app is a separate
          change.
        </p>
      </Callout>

      <H2>An agent did this on its first attempt</H2>
      <Prose>
        <p>
          The repo&apos;s <Code>.harness/</Code> recipe asks a coding agent to add ETH-USD by following{" "}
          <Code>AGENTS.md</Code>, then grades the result from static checks up to a live feed check on testnet. A
          recorded run passed on attempt 1 of 3, changing 4 files and no contracts. See{" "}
          <Link href="/docs/harness">Hedera Harness</Link>.
        </p>
      </Prose>
    </Doc>
  );
}
