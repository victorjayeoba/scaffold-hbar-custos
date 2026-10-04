import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, Ext, H2, H3, HashScan, Prose, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Hedera Harness",
  description:
    "The Hedera Harness recipe that has an AI agent add an ETH-USD market to Custos, and how it was verified.",
});

const code = (text: string) => <Code>{text}</Code>;

export default function Harness() {
  return (
    <Doc
      href="/docs/harness"
      section="Reference"
      title="Hedera Harness"
      lead="The .harness/ folder is a Hedera Harness recipe: it hands an AI coding agent one realistic task on this template, then checks the result in tiers, from file checks up to a live action on Hedera testnet."
    >
      <H2>The recipe</H2>
      <Prose>
        <p>
          <strong>The task:</strong> add an ETH-USD market by following the &quot;Add a market&quot; recipe in{" "}
          <Code>AGENTS.md</Code>. In Custos a market is configuration, not code: an entry in{" "}
          <Code>packages/foundry/markets.json</Code>, an ETH-specific test, and a row in the README&apos;s markets
          table. The contracts must not change. The full brief is <Code>.harness/prd.md</Code>; the spec is{" "}
          <Code>.harness/spec.yaml</Code> (<Ext href="https://github.com/hedera-dev/hedera-harness">hedera-harness</Ext>{" "}
          1.2.2, schema v2).
        </p>
        <p>
          The same steps by hand are in <Link href="/docs/integrate/add-market">Add a market</Link>.
        </p>
      </Prose>

      <H2>Tiers</H2>
      <Table
        head={["Tier", "File", "Checks"]}
        rows={[
          [
            "0",
            code("validators/static.json"),
            <>
              {code("markets.json")} has ETH-USD with Chainlink ETH/USD and Supra pair 19, HBAR-USD is untouched,{" "}
              {code("test/markets/EthUsdMarket.t.sol")} exists, the README lists {code("ETH-USD")}, AGENTS.md documents{" "}
              {code("markets.json")} and {code("check-market")}, and no root or app {code(".env")} file exists (
              {code("packages/foundry/.env")} is allowed: the template&apos;s {code("postinstall")} copies it from{" "}
              {code(".env.example")})
            </>,
          ],
          [
            "1",
            code("validators/yarn.json"),
            <>
              {code("check-markets ETH-USD")} (offline config check), the ETH test, all contract tests and invariants,{" "}
              {code("foundry:lint")}, the app&apos;s type check, lint and production build. No keys, no network
            </>,
          ],
          [
            "2",
            code("validators/playwright-smoke.yaml"),
            <>
              {code("/")}, {code("/keeper")}, {code("/trade")}, {code("/pool")} and {code("/debug")} load with no error
              overlay
            </>,
          ],
          [
            "3",
            code("acceptance-contract.json"),
            "An adversarial agent grades the running app with no wallet: the keeper, trade and pool pages still read the live HBAR-USD deployment (adding a market must not break anything)",
          ],
          [
            "3.5",
            <>
              {code("spec.yaml")} → {code("chainValidation")}
            </>,
            "Deploys a PriceGuard with the new ETH-USD config from the harness's throwaway testnet account and reads both live feeds; fails if either doesn't answer",
          ],
        ]}
      />

      <H2>Run it</H2>
      <CodeBlock
        code={`# check the recipe itself
yarn harness:doctor --recipe-only

# tiers 0–2 against the current workspace, no agent
yarn harness:validate

# the full loop: the agent implements the PRD, every tier runs,
# failures go back to the agent (up to 3 attempts)
export HEDERA_OPERATOR_ID=0.0.xxxx HEDERA_OPERATOR_KEY=0x...   # an ECDSA testnet account with ~15 ℏ; shell only, never a file
yarn harness:run`}
      />
      <Prose>
        <p>
          The chain tier needs Foundry (<Code>forge</Code>, <Code>cast</Code>) on the PATH. The harness creates one
          EVM-aliased account per run, funds it with 10 ℏ from your operator, passes it to the deploy command as{" "}
          <Code>DEPLOYER_PRIVATE_KEY</Code> (environment only), and sweeps what&apos;s left back afterwards. A
          PriceGuard deploy costs about 1 ℏ. Run artifacts go to <Code>.harness/runs/</Code>, which is gitignored.
        </p>
        <p>
          <Code>hedera-harness</Code> and <Code>playwright</Code> must both be <strong>root</strong> devDependencies
          (they are, in <Code>package.json</Code>). Under <Code>npx hedera-harness</Code>, the tool can&apos;t import{" "}
          <Code>playwright</Code> from npm&apos;s cache, and the Tier 2 gate fails before any route with no visible
          reason.
        </p>
      </Prose>

      <H2>How it was verified</H2>

      <H3>Fails without the feature, passes with it</H3>
      <Prose>
        <p>
          Before handing the task to an agent, the PRD was solved by hand in three files (the <Code>markets.json</Code>{" "}
          entry, the ETH test, the README row), kept as <Code>.harness/reference/eth-usd.patch</Code> and not applied:
          the template ships without ETH-USD on purpose, so the recipe has something to do.{" "}
          <Code>hedera-harness validate .harness/spec.yaml</Code> on 2026-10-03, on two fresh clones:
        </p>
      </Prose>
      <Table
        head={["Workspace", "Result"]}
        rows={[
          [
            <>{code("main")} as shipped (no ETH-USD)</>,
            <>
              {code("passed=false")}, <strong>8 findings, every one about the missing feature</strong>, no false alarms.
              Tier 2 is skipped because Tier 1 failed
            </>,
          ],
          [
            <>{code("main")} + the reference implementation (3 files)</>,
            <strong key="pass">
              {code("passed=true")}, {code("findings=0")}, {code("playwrightGate=true routes=5")}
            </strong>,
          ],
        ]}
      />
      <CodeBlock
        lang="text"
        title="the passing run"
        code={`command yarn install exit=0
command yarn workspace @sh/foundry check-markets ETH-USD exit=0
command node -e "require('fs').statSync('packages/foundry/test/markets/EthUsdMarket.t.sol')" && yarn workspace @sh/foundry test --match-path test/markets/EthUsdMarket.t.sol exit=0
command yarn foundry:test exit=0
command yarn foundry:lint exit=0
command yarn next:check-types exit=0
command yarn next:lint --max-warnings=0 exit=0
command yarn next:build exit=0
Playwright gate: / /keeper /trade /pool /debug → 200, rendered, 0 console errors, no forbidden text
Validation finished  passed=true  findings=0  playwrightGate=true routes=5`}
      />

      <H3>CI proves it both ways</H3>
      <Prose>
        <p>
          <Code>.github/workflows/harness.yaml</Code> runs on Ubuntu with no secrets, on every push to <Code>main</Code>{" "}
          and on pull requests. It checks the recipe with <Code>yarn harness:doctor --recipe-only</Code>, then{" "}
          <Code>yarn harness:validate</Code> on <Code>main</Code> as shipped must fail, and fail for the missing ETH-USD
          market; then it applies <Code>.harness/reference/eth-usd.patch</Code> and <Code>yarn harness:validate</Code>{" "}
          must pass, Playwright tier included. The chain tier and the agent tiers need an operator account and an agent,
          so they run only under <Code>yarn harness:run</Code>.
        </p>
      </Prose>

      <H3>A recorded agent run</H3>
      <Prose>
        <p>
          <Code>hedera-harness run .harness/spec.yaml</Code> on 2026-10-03, on a fresh clone of <Code>main</Code> with
          no ETH-USD, agent preset <Code>claude</Code> (Claude Opus), operator an ECDSA testnet account passed through
          environment variables only.
        </p>
      </Prose>
      <Table
        head={["Stage", "Outcome"]}
        rows={[
          [
            "Result",
            <>
              <strong>PASSED, attempt 1 of 3, no findings</strong> ({code("passed=true")}, {code("openFindingIds=[]")})
            </>,
          ],
          ["Duration", "15 min 39 s (01:39:05 → 01:54:43 UTC), 17 min wall clock including setup"],
          [
            "1/4 Generate",
            <>
              The agent read {code("AGENTS.md")} and the PRD and changed 4 files, no contracts: the ETH-USD entry in{" "}
              {code("markets.json")}, a new {code("test/markets/EthUsdMarket.t.sol")} (5 tests, reading the entry from{" "}
              {code("markets.json")}), a README row noting ~3,600 s on mainnet, and its own{" "}
              {code("GENERATION_NOTES.md")}
            </>,
          ],
          [
            "2/4 Assert",
            <>
              Tier 0 static: 0 findings. Tier 1: {code("check-markets ETH-USD")}, the ETH test, all contract tests,{" "}
              {code("foundry:lint")}, type check, app lint and production build all exit 0
            </>,
          ],
          [
            "Chain (Tier 3.5)",
            <>
              The harness created and funded throwaway account <HashScan kind="account" id="0.0.10834938" />, ran{" "}
              {code("yarn custos:check-market:testnet --market ETH-USD")} (a PriceGuard deployed with the agent&apos;s
              config reading both live feeds), then swept the account back to 0 ℏ
            </>,
          ],
          [
            "3/4 Smoke",
            <>
              Playwright gate: {code("/")}, {code("/keeper")}, {code("/trade")}, {code("/pool")}, {code("/debug")}
            </>,
          ],
          ["4/4 Evaluate", "The adversarial validator's verdict, quoted below"],
        ]}
      />
      <Callout type="tip" title="The validator's verdict, verbatim">
        <p>
          &quot;All four assertions positively verified on the running app at http://localhost:3001. Keeper, trade, pool
          and debug pages all render with the expected labels, controls and live data; new ETH-USD market was added as
          configuration only and did not disturb the existing HBAR-USD surfaces.&quot;
        </p>
      </Callout>
      <Prose>
        <p>
          The harness committed the agent&apos;s work to a throwaway run branch, which isn&apos;t kept in the repo: the
          recipe&apos;s job is to produce it, so <Code>main</Code> stays without ETH-USD.
        </p>
      </Prose>

      <H2>Windows</H2>
      <Callout type="warning" title="Run the harness on macOS, Linux or CI">
        <p>
          <Code>hedera-harness</Code> 1.2.2 starts the dev server with <Code>spawn(..., {"{ detached: true }"})</Code>.
          On Windows that gives the child its own console, so the gate never sees <Code>Local: http://…</Code>, times
          out after 30 s, and leaves the dev server running.
        </p>
        <p>
          Two more spawns assume a POSIX host: the Tier 3 browser preflight runs <Code>spawn(&quot;npx&quot;, …)</Code>{" "}
          without a shell (on Windows <Code>npx</Code> is <Code>npx.cmd</Code>), and its cleanup then throws{" "}
          <Code>EBUSY</Code> on the probe&apos;s temp folder and ends the run. The passing validate run and the recorded
          agent run were made on Windows with local one-line patches to the installed harness (
          <Code>detached: process.platform !== &quot;win32&quot;</Code>,{" "}
          <Code>shell: process.platform === &quot;win32&quot;</Code> on the preflight spawn,{" "}
          <Code>.catch(() =&gt; undefined)</Code> on the cleanup) and Claude Code&apos;s native <Code>claude.exe</Code>{" "}
          folder first on <Code>PATH</Code>. None of this touches the recipe or the template.
        </p>
      </Callout>
    </Doc>
  );
}
