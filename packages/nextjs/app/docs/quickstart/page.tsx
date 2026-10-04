import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, Ext, Figure, H2, Prose, Step, Steps, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Quickstart",
  description: "Scaffold Custos, run its tests, deploy your own market to Hedera testnet and run the app.",
});

export default function Quickstart() {
  return (
    <Doc
      href="/docs/quickstart"
      section="Getting started"
      title="Quickstart"
      lead="Scaffold the template and run its test suite in a few minutes with no account. Then deploy your own market to Hedera testnet and watch the network keep it."
    >
      <H2>Before you start</H2>
      <Prose>
        <ul>
          <li>
            <strong>Node.js</strong> 20.18.3 or later, and <strong>Git</strong>.
          </li>
          <li>
            <strong>
              <Ext href="https://getfoundry.sh">Foundry</Ext>
            </strong>{" "}
            (<Code>forge</Code> and <Code>cast</Code>). The contracts build, test and deploy with it.
          </li>
          <li>
            For the testnet steps, a Hedera testnet <strong>ECDSA</strong> account funded from the{" "}
            <Ext href="https://portal.hedera.com/faucet">Hedera faucet</Ext>. EVM signing needs an ECDSA key; an ED25519
            account has none.
          </li>
        </ul>
      </Prose>

      <H2>1. Scaffold and test locally</H2>
      <Prose>
        <p>
          No account and nothing spent. The tests emulate Hedera&apos;s Token Service and mock the Schedule Service.
        </p>
      </Prose>
      <Steps>
        <Step title="Create your project">
          <CodeBlock code="npm create scaffold-hbar@latest --template victorjayeoba/scaffold-hbar-custos" />
          <p>The CLI asks for a project name and installs everything.</p>
        </Step>
        <Step title="Compile and test the contracts">
          <CodeBlock
            code={`cd <your-project>
yarn foundry:compile
yarn foundry:test`}
          />
          <p>
            This runs every unit, fuzz and invariant test, including the solvency invariants (no bad debt, the pool
            always covers the largest possible gains, the keeper reserve always covers the next run).
          </p>
        </Step>
      </Steps>
      <Callout title="Why the keeper only runs on Hedera">
        <p>
          The Schedule Service exists only on Hedera, not on Anvil or a fork. Locally the tests mock it; the live keeper
          runs on testnet.
        </p>
      </Callout>

      <H2>2. Deploy your own market to testnet</H2>
      <Steps>
        <Step title="Create or import a deployer account">
          <CodeBlock code={`yarn foundry:account:generate      # or: yarn foundry:account:import`} />
          <p>Fund it from the faucet. The deploy sends HBAR, as the table below shows.</p>
        </Step>
        <Step title="Deploy and link the contracts">
          <CodeBlock code="yarn custos:deploy:testnet" />
          <p>
            Deploys <Code>PriceGuard</Code>, <Code>LiquidityPool</Code> and <Code>PerpMarket</Code>, links them, creates
            the cUSDC-LP share token on the Token Service and funds the keeper. It writes{" "}
            <Code>packages/foundry/deployments/296.json</Code> and regenerates{" "}
            <Code>packages/nextjs/contracts/deployedContracts.ts</Code>, so the app points at your market.
          </p>
        </Step>
        <Step title="Book the first tick">
          <CodeBlock code="yarn custos:start:testnet" />
          <p>
            Associates the pool and market with USDC and books the keeper&apos;s first tick. From here on the network
            runs it: every tick books the next.
          </p>
        </Step>
        <Step title="Seed it (optional)">
          <CodeBlock code="yarn custos:demo:testnet" />
          <p>Swaps HBAR to USDC on SaucerSwap, deposits it in the pool, and opens a 50x long with 1 HBAR.</p>
        </Step>
      </Steps>

      <Table
        head={["What the scripts send", "Default", "Set with"]}
        rows={[
          ["The keeper's HBAR reserve", "40 ℏ", <Code key="f">KEEPER_FUND</Code>],
          [
            "Creating the share token (about 12 ℏ is used, the rest comes back)",
            "30 ℏ",
            <Code key="s">SHARE_TOKEN_FEE</Code>,
          ],
          ["Demo: HBAR swapped to pool USDC", "120 ℏ", <Code key="p">DEMO_POOL_HBAR</Code>],
          ["Demo: HBAR per trade", "1 ℏ", <Code key="t">DEMO_TRADE_HBAR</Code>],
        ]}
      />
      <Callout type="warning" title="Keys stay out of files">
        <p>
          The testnet scripts sign with <Code>--keystore &lt;name&gt;</Code> (or <Code>ETH_KEYSTORE_ACCOUNT</Code>), or
          with <Code>DEPLOYER_PRIVATE_KEY</Code> set in your shell. Never write a private key into a file.
        </p>
      </Callout>

      <H2>3. Run the app</H2>
      <CodeBlock code="yarn next:dev" />
      <Prose>
        <p>
          Open <Code>localhost:3000/keeper</Code>. The first network run arrives one interval (30 minutes by default)
          after <Code>custos:start:testnet</Code>. Connect HashPack, Kabila, MetaMask or any WalletConnect wallet; see{" "}
          <Link href="/docs/guides/trading">Trade</Link> for what each page does.
        </p>
      </Prose>
      <Figure
        src="/docs/shot-keeper.png"
        alt="The keeper page: the next scheduled check, the HBAR held up front per run, and the reserve"
        caption="/keeper on the live testnet deployment"
        width={1280}
        height={800}
      />

      <H2>Next steps</H2>
      <Prose>
        <ul>
          <li>
            <Link href="/docs/architecture">How it works</Link>: the contracts and a liquidation end to end.
          </li>
          <li>
            <Link href="/docs/integrate/add-market">Add a market</Link>: ETH-USD as configuration.
          </li>
          <li>
            <Link href="/docs/troubleshooting">Troubleshooting</Link>: every error and its fix.
          </li>
        </ul>
      </Prose>
    </Doc>
  );
}
