import Link from "next/link";
import type { NextPage } from "next";
import { InstallCommand } from "~~/components/custos/InstallCommand";
import { MetronomeStack } from "~~/components/custos/MetronomeStack";
import { OracleReadout } from "~~/components/custos/OracleReadout";
import { ScheduleRail } from "~~/components/custos/ScheduleRail";
import { TestnetProof } from "~~/components/custos/TestnetProof";
import { TESTNET_NOTES_URL } from "~~/utils/custos/testnet";

const REPO_URL = "https://github.com/victorjayeoba/scaffold-hbar-custos";

// What happens inside one scheduled run, in order. This is a real sequence, so it's numbered.
const tickSteps = [
  {
    title: "Hedera calls tick()",
    body: "The call was booked on the previous run through the Schedule Service (HIP-1215). No person or server sends it.",
  },
  {
    title: "Prices are checked",
    body: "PriceGuard reads Chainlink and Supra. If either is stale or they disagree, the run stops here and liquidates no one.",
  },
  {
    title: "Funding is charged",
    body: "The side with more open interest pays the other, so the market leans back toward balance.",
  },
  {
    title: "Accounts are swept",
    body: "A page of traders is checked. Anyone under the maintenance margin is closed and their collateral goes to the pool.",
  },
  {
    title: "The next run is booked",
    body: "Before it ends, the contract books its own next call, trying the following seconds if one is full.",
  },
];

const parts = [
  {
    name: "ScheduledKeeper",
    path: "packages/foundry/contracts/ScheduledKeeper.sol",
    body: "Runs any job on a timer with no bot. Books itself, pays from its own HBAR reserve, and anyone can restart it if the chain of calls breaks.",
  },
  {
    name: "MarginAccount",
    path: "packages/foundry/contracts/MarginAccount.sol",
    body: "Collateral, profit and loss, health and liquidation rules. The same book works for lending or repo.",
  },
  {
    name: "PriceGuard",
    path: "packages/foundry/contracts/PriceGuard.sol",
    body: "One place prices come from: Chainlink first, Supra as the check, with age and disagreement limits.",
  },
];

// Every Hedera service and integration the template leans on, with what we measured on testnet.
const underTheHood = [
  {
    name: "Schedule Service (HIP-1215)",
    body: "Each run books the next with scheduleCall, so the market never waits on a bot. Booking costs about 1.41M gas. On testnet a whole run (funding, sweep and booking) used 1.62M gas and cost 1.36 HBAR, paid from the contract's own reserve.",
  },
  {
    name: "Token Service",
    body: "Collateral is SaucerSwap's testnet USDC (0.0.5449), an HTS token. The market, the pool and the deposit zap associate with it when they start, so traders and LPs can use it straight away.",
  },
  {
    name: "Chainlink",
    body: "The HBAR/USD push feed prices every trade, every liquidation and every funding charge. It needs no API key and no update fee.",
  },
  {
    name: "Supra",
    body: "The HBAR/USDT push feed is the independent check. It quotes USDT and updates about hourly on testnet, so the two feeds may sit up to 5% apart. The live readout shows both limits as PriceGuard holds them.",
  },
  {
    name: "SaucerSwap",
    body: "HBAR goes in and out of both sides through its V1 router: open with HBAR, close to HBAR, and deposit into the pool with HBAR. Every swap the contracts make for someone else must fill within 3% of Chainlink.",
  },
  {
    name: "Smart contracts",
    body: "Solidity contracts on Hedera's EVM, with unit tests and fuzzed solvency invariants: the pool always covers what it owes.",
  },
  {
    name: "Hedera timing",
    body: "block.timestamp is the start of a ~2 second block, so a check that fires on time can look a second early. The keeper allows five seconds.",
  },
];

const setupSteps = [
  "Create the project with the command above and pick a deployer account.",
  "Get testnet HBAR from the Hedera Portal faucet and testnet USDC from Circle's faucet.",
  "Deploy to Hedera testnet. The deploy script books the first network check.",
  "Start the app and open the Keeper page to watch the schedule run.",
];

const Home: NextPage = () => {
  return (
    <div className="flex grow flex-col">
      <section className="bg-black text-white">
        <div className="mx-auto max-w-7xl px-5 pt-12 pb-14 sm:pt-16">
          <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <h1 className="text-[clamp(2.75rem,6.5vw,5rem)] font-normal leading-[1.05] tracking-[-0.02em]">
                Margin kept by the network.
              </h1>
              <p className="mt-6 max-w-xl text-xl leading-relaxed text-white">
                Open a leveraged HBAR position. If it falls under its margin, Hedera liquidates it on schedule. No
                keeper bots, no servers.
              </p>
              <p className="mt-3 max-w-xl leading-relaxed text-white/70">
                A Scaffold-HBAR template: contracts, app and docs for margin trading, in one command.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn rounded-full border-0 bg-hedera-ultraviolet px-6 text-white shadow-none hover:bg-hedera-violet"
                >
                  Read the code on GitHub
                </a>
                <Link
                  href="/debug"
                  className="btn rounded-full border border-white bg-transparent px-6 text-white shadow-none hover:bg-white hover:text-black"
                >
                  Open the contracts
                </Link>
              </div>
            </div>
            <div className="flex justify-center overflow-hidden max-lg:h-[340px] max-lg:[&>div]:scale-[0.7] max-lg:[&>div]:origin-top">
              <MetronomeStack />
            </div>
          </div>
          <div className="mt-10 max-w-4xl">
            <ScheduleRail />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pt-16">
        <TestnetProof />
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-normal tracking-[-0.01em]">Two prices, checked against each other</h2>
        <p className="mt-3 mb-8 max-w-2xl text-base-content/70">
          These are the live feeds on Hedera testnet, read straight from their contracts. Custos never liquidates on a
          price it can&apos;t confirm.
        </p>
        <OracleReadout />
      </section>

      <section className="w-full bg-base-100">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-3xl font-normal tracking-[-0.01em]">What the network does every thirty minutes</h2>
            <p className="mt-3 text-base-content/70">
              Other chains rent this job to Gelato, Chainlink Automation or a team&apos;s own bot. Hedera can book a
              contract call for later, so the market keeps itself.
            </p>
          </div>
          <ol className="m-0 list-none space-y-6 p-0">
            {tickSteps.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[2.5rem_1fr] gap-x-2">
                <span className="text-2xl tabular-nums text-primary">{i + 1}</span>
                <div>
                  <h3 className="m-0 text-lg font-normal">{step.title}</h3>
                  <p className="mt-1 mb-0 text-base-content/70">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pt-16">
        <h2 className="text-3xl font-normal tracking-[-0.01em]">Under the hood</h2>
        <p className="mt-3 mb-8 max-w-2xl text-base-content/70">
          What Custos uses on Hedera, and what we measured running it on testnet.{" "}
          <a href={TESTNET_NOTES_URL} target="_blank" rel="noreferrer" className="link">
            Read the testnet notes
          </a>
          .
        </p>
        <dl className="m-0 grid gap-x-10 gap-y-0 md:grid-cols-2">
          {underTheHood.map(item => (
            <div key={item.name} className="border-t border-base-300 py-5">
              <dt className="text-lg">{item.name}</dt>
              <dd className="m-0 mt-1 text-base-content/75">{item.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-normal tracking-[-0.01em]">Parts you can take for your own project</h2>
        <p className="mt-3 mb-8 max-w-2xl text-base-content/70">
          The perpetual market is the demo. These three contracts are the template.
        </p>
        <div className="divide-y divide-base-300 border-y border-base-300">
          {parts.map(part => (
            <div key={part.name} className="grid gap-2 py-6 md:grid-cols-[22rem_1fr] md:gap-8">
              <div>
                <div className="text-xl">{part.name}</div>
                <a
                  href={`${REPO_URL}/blob/main/${part.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link text-xs text-base-content/60"
                >
                  {part.path}
                </a>
              </div>
              <p className="m-0 max-w-2xl text-base-content/80">{part.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="custos-night text-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-3xl font-normal tracking-[-0.01em]">Start from one command</h2>
          <div className="mt-6 max-w-3xl">
            <InstallCommand onDark />
          </div>
          <ol className="mt-8 max-w-2xl list-decimal space-y-3 pl-5 text-white/80 marker:text-white/50">
            {setupSteps.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
};

export default Home;
