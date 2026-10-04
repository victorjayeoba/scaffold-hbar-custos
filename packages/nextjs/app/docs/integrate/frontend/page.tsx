import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, H2, H3, Prose, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Read and write from the app",
  description: "Call the Custos contracts from React with the scaffold-hbar hooks and the generated ABIs.",
});

export default function Frontend() {
  return (
    <Doc
      href="/docs/integrate/frontend"
      section="Build with Custos"
      title="Read and write from the app"
      lead="The app reads and writes the contracts through Scaffold-HBAR's typed hooks, fed by a generated file of addresses and ABIs. Every snippet on this page is the pattern a page in the app already uses."
    >
      <H2>Addresses and ABIs</H2>
      <Prose>
        <p>
          <Code>packages/nextjs/contracts/deployedContracts.ts</Code> holds the address and ABI of{" "}
          <Code>PriceGuard</Code>, <Code>LiquidityPool</Code>, <Code>PerpMarket</Code> and <Code>HbarDepositZap</Code>{" "}
          on chain 296 (Hedera testnet). Don&apos;t edit it by hand: <Code>yarn custos:deploy:testnet</Code> regenerates
          it through <Code>scripts-js/generateTsAbis.js</Code> after a deploy of the default market. Third-party
          contracts (the two oracles) are in <Code>externalContracts.ts</Code>.
        </p>
        <p>
          Hooks look contracts up by name, so <Code>contractName</Code> and <Code>functionName</Code> are type-checked
          against the ABI, and so are <Code>args</Code> and return values.
        </p>
      </Prose>

      <H2>The hooks</H2>
      <Table
        head={["Hook", "Import from", "Use it for"]}
        rows={[
          [<Code key="h">useScaffoldReadContract</Code>, <Code key="i">~~/hooks/scaffold-hbar</Code>, "One view call"],
          [
            <Code key="h">useScaffoldWriteContract</Code>,
            <Code key="i">~~/hooks/scaffold-hbar</Code>,
            "Transactions, with toasts",
          ],
          [
            <Code key="h">useDeployedContractInfo</Code>,
            <Code key="i">~~/hooks/scaffold-hbar</Code>,
            "A contract's address and ABI",
          ],
          [
            <Code key="h">useTargetNetwork</Code>,
            <Code key="i">~~/hooks/scaffold-hbar</Code>,
            "The chain the app points at",
          ],
          [
            <Code key="h">useKeeper</Code>,
            <Code key="i">~~/hooks/custos/useKeeper</Code>,
            "nextRunAt, lastRunAt, interval, runCount, runsLeft",
          ],
          [
            <Code key="h">usePool</Code>,
            <Code key="i">~~/hooks/custos/usePool</Code>,
            "Everything the pool page reads",
          ],
          [
            <Code key="h">useTradeAction</Code>,
            <Code key="i">~~/hooks/custos/useTradeAction</Code>,
            "PerpMarket writes, with errors in plain words",
          ],
          [
            <Code key="h">useHtsToken</Code>,
            <Code key="i">~~/hooks/custos/useHtsToken</Code>,
            "Token balance, allowance, association; associate() and approve()",
          ],
          [
            <Code key="h">useKeeperActivity</Code>,
            <Code key="i">~~/hooks/custos/useKeeperActivity</Code>,
            "Keeper history from the mirror node",
          ],
        ]}
      />
      <Callout type="tip" title="Poll every 30 seconds, not every block">
        <p>
          The stock template re-reads on every Hedera block (about 2 s), which floods the public relay. Every Custos
          read spreads <Code>POLL</Code> from <Code>~~/hooks/custos/poll</Code>: <Code>watch: false</Code> and a refetch
          every 30 s. New reads should too.
        </p>
      </Callout>

      <H2>Read the contracts</H2>
      <H3>The keeper&apos;s schedule</H3>
      <Prose>
        <p>
          <Code>nextRunAt</Code> and <Code>runsLeft</Code> come from <Code>PerpMarket</Code>, which is the keeper. This
          is what <Code>useKeeper</Code> does:
        </p>
      </Prose>
      <CodeBlock
        lang="tsx"
        code={`
import { POLL } from "~~/hooks/custos/poll";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

const { data: nextRunAt } = useScaffoldReadContract({
  contractName: "PerpMarket",
  functionName: "nextRunAt",
  ...POLL,
});
const { data: runsLeft } = useScaffoldReadContract({
  contractName: "PerpMarket",
  functionName: "runsLeft",
  ...POLL,
});
// Both are bigint: nextRunAt in unix seconds, runsLeft a count of full gas holds.
`}
      />
      <Prose>
        <p>
          Or take them ready-made: <Code>const {"{ nextRunAt, runsLeft, interval }"} = useKeeper();</Code> returns
          numbers.
        </p>
      </Prose>

      <H3>The pool&apos;s value</H3>
      <CodeBlock
        lang="tsx"
        code={`
const { data: totalAssets } = useScaffoldReadContract({
  contractName: "LiquidityPool",
  functionName: "totalAssets",
  ...POLL,
});
// USDC, 6 decimals: formatUnits(totalAssets, 6)
`}
      />
      <Prose>
        <p>
          A read with arguments passes <Code>args</Code>, as <Code>usePool</Code> does for the connected LP:
        </p>
      </Prose>
      <CodeBlock
        lang="tsx"
        code={`
const { data: maxRedeem } = useScaffoldReadContract({
  contractName: "LiquidityPool",
  functionName: "maxRedeem",
  args: [owner],
  ...POLL,
});
`}
      />

      <H2>Write to the contracts</H2>
      <Prose>
        <p>
          <Code>/trade</Code> sends every <Code>PerpMarket</Code> transaction through <Code>useTradeAction</Code>. Its{" "}
          <Code>run</Code> simulates the call first, so a revert comes back as a sentence before the wallet opens; then
          it estimates gas plus 30% (falling back to known-good limits, since Hedera&apos;s estimates fall short for HTS
          calls) and sends through the scaffold transactor, which shows a toast with a HashScan link.
        </p>
      </Prose>
      <H3>Open with USDC</H3>
      <CodeBlock
        lang="tsx"
        code={`
import { useTradeAction } from "~~/hooks/custos/useTradeAction";

const action = useTradeAction();

// collateral is USDC with 6 decimals; approve the market for it first (see below)
const ok = await action.run(
  { functionName: "open", args: [isLong, collateral, BigInt(leverage)] },
  "The market couldn't take your USDC. Check your balance, approval and association.",
);
// ok is false on a revert; action.error then holds one plain sentence to render
`}
      />

      <H3>Open with HBAR</H3>
      <Prose>
        <p>
          The amount the user types is in HBAR with 8 decimals (tinybars), and that is what the quote takes. The
          transaction&apos;s <Code>value</Code> is not: the JSON-RPC relay takes <Code>value</Code> with 18 decimals
          (weibars), so <Code>TradeOpenForm</Code> multiplies by <Code>WEIBARS_PER_TINYBAR</Code> (10¹⁰).
        </p>
      </Prose>
      <CodeBlock
        lang="tsx"
        code={`
import { WEIBARS_PER_TINYBAR, minOutAfterSlippage } from "~~/utils/custos/perpMath";

// tinybars: the HBAR amount with 8 decimals
const { data: quote } = useScaffoldReadContract({
  contractName: "PerpMarket",
  functionName: "quoteHbarToUsdc",
  args: [tinybars],
  ...POLL,
});
const minCollateral = quote !== undefined ? minOutAfterSlippage(quote, 100n) : undefined; // 1%

await action.run({
  functionName: "openWithHbar",
  args: [isLong, BigInt(leverage), minCollateral!],
  value: tinybars * WEIBARS_PER_TINYBAR,
});
`}
      />
      <Callout type="warning" title="Send weibars, not tinybars">
        <p>
          Passing tinybars as <Code>value</Code> sends 10¹⁰ times less HBAR than you meant. <Code>parseEther</Code> on
          an HBAR amount gives weibars directly; that is how <Code>/keeper</Code> sends <Code>fund()</Code>.
        </p>
      </Callout>

      <H3>Close to HBAR</H3>
      <Prose>
        <p>
          <Code>closeToHbar(minHbarOut)</Code> takes its minimum in tinybars. <Code>TradePositionCard</Code> quotes the
          expected USDC payout and subtracts slippage:
        </p>
      </Prose>
      <CodeBlock
        lang="tsx"
        code={`
const { data: hbarQuote } = useScaffoldReadContract({
  contractName: "PerpMarket",
  functionName: "quoteUsdcToHbar",
  args: [payout], // USDC, 6 decimals
  ...POLL,
});
const minHbarOut = hbarQuote !== undefined ? minOutAfterSlippage(hbarQuote, 100n) : undefined;

await action.run({ functionName: "closeToHbar", args: [minHbarOut ?? 0n] });
// or, paid in USDC: await action.run({ functionName: "close" });
`}
      />

      <H3>A plain write</H3>
      <Prose>
        <p>
          For a contract <Code>useTradeAction</Code> doesn&apos;t cover, use <Code>useScaffoldWriteContract</Code>. This
          is <Code>KeeperActions</Code> on <Code>/keeper</Code>, with explicit gas (<Code>revive()</Code> books a
          schedule, which alone costs about 1.41M gas):
        </p>
      </Prose>
      <CodeBlock
        lang="tsx"
        code={`
import { parseEther } from "viem";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";

const { writeContractAsync } = useScaffoldWriteContract({ contractName: "PerpMarket" });

await writeContractAsync({ functionName: "fund", value: parseEther(amount), gas: 100_000n });
await writeContractAsync({ functionName: "revive", gas: 2_000_000n });
`}
      />

      <H3>Deposit with HBAR through the zap</H3>
      <Prose>
        <p>
          The pool page calls <Code>HbarDepositZap</Code> through <Code>usePoolWrite().depositWithHbar</Code> (
          <Code>app/pool/_lib/usePoolWrite.ts</Code>), which simulates first so a revert reaches the page as words.
          It&apos;s the same pattern as <Code>openWithHbar</Code>: quote in tinybars, send <Code>value</Code> in
          weibars, and the caller must already be associated with cUSDC-LP. The bare version:
        </p>
      </Prose>
      <CodeBlock
        lang="tsx"
        code={`
const { data: usdcQuote } = useScaffoldReadContract({
  contractName: "HbarDepositZap",
  functionName: "quote",
  args: [tinybars],
  ...POLL,
});
const { writeContractAsync } = useScaffoldWriteContract({ contractName: "HbarDepositZap" });

await writeContractAsync({
  functionName: "depositWithHbar",
  args: [minOutAfterSlippage(usdcQuote!, 100n)], // the oracle floor applies on top
  value: tinybars * WEIBARS_PER_TINYBAR,
});
`}
      />

      <H2>Associate and approve tokens</H2>
      <Prose>
        <p>
          USDC and cUSDC-LP are Hedera Token Service tokens. An account must be associated with one before it can
          receive it, and a contract must be approved before it can pull it. <Code>useHtsToken</Code> handles both for
          any token, and checks association on the mirror node. <Code>usePool</Code> returns it for USDC (spender: the
          pool) and for the share token:
        </p>
      </Prose>
      <CodeBlock
        lang="tsx"
        code={`
import { usePool } from "~~/hooks/custos/usePool";
import { usePoolWrite } from "~~/app/pool/_lib/usePoolWrite";

const { usdc, shares } = usePool(address);
const { deposit, redeem } = usePoolWrite(address);

// Deposit: associate with USDC and cUSDC-LP, approve USDC, deposit
if (usdc.association === "not-associated") await usdc.associate();
if (shares.association === "not-associated") await shares.associate();
if ((usdc.allowance ?? 0n) < amount) await usdc.approve(amount); // exact amount, never unlimited
await deposit(amount);

// Redeem: the pool pulls the shares and burns them, so approve it on cUSDC-LP first
await shares.approve(sharesToRedeem);
await redeem(sharesToRedeem);
`}
      />
      <Prose>
        <p>
          <Code>/trade</Code> does the same with the market as spender: <Code>usdc.associate()</Code>, then{" "}
          <Code>usdc.approve(amount)</Code>, then <Code>open</Code>. <Code>closeToHbar</Code> and{" "}
          <Code>openWithHbar</Code> need no approval. <Code>usePoolWrite</Code> simulates each pool call first so a
          revert reaches the page as a named error. An <Code>association</Code> of <Code>&quot;auto&quot;</Code> means
          the account has unlimited auto-associations and needs no step.
        </p>
      </Prose>

      <H2>History from the mirror node</H2>
      <Prose>
        <p>
          The public relay limits <Code>eth_getLogs</Code> ranges, so the app reads history from the Hedera mirror node
          instead. <Code>useKeeperActivity</Code> looks up the market&apos;s Hedera id, then pages through:
        </p>
        <ul>
          <li>
            <Code>/api/v1/contracts/&lt;id&gt;/results/logs</Code>, decoded against the <Code>PerpMarket</Code> ABI with
            viem&apos;s <Code>decodeEventLog</Code>;
          </li>
          <li>
            <Code>/api/v1/transactions?account.id=&lt;id&gt;</Code>, whose <Code>scheduled: true</Code> marks a run the
            Schedule Service executed, and whose result shows failed runs (which leave no log).
          </li>
        </ul>
      </Prose>
      <CodeBlock
        lang="tsx"
        code={`
import { useKeeperActivity } from "~~/hooks/custos/useKeeperActivity";

const { entries, loadMore, hasMore } = useKeeperActivity();
// entries: { timestamp, events, scheduled, result, feePaidByContract }[], newest first
`}
      />
      <Callout title="Don't trust the mirror node's from">
        <p>
          For a scheduled run the mirror node&apos;s <Code>from</Code> is the relay&apos;s operator account, not the
          contract. Use <Code>scheduled</Code>, or the <Code>byNetwork</Code> field of <Code>Liquidated</Code>.
        </p>
      </Callout>
      <Prose>
        <p>
          <Code>usePoolEarnings</Code> reads the pool&apos;s flows the same way, and <Code>useHcsAuditLog</Code> reads
          the keeper&apos;s audit log from HCS topic messages. Errors from any of these calls are listed in{" "}
          <Link href="/docs/troubleshooting">Troubleshooting</Link>.
        </p>
      </Prose>
    </Doc>
  );
}
