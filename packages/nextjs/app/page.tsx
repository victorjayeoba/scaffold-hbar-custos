import Link from "next/link";
import type { NextPage } from "next";
import { InstallCommand } from "~~/components/custos/InstallCommand";
import { OracleReadout } from "~~/components/custos/OracleReadout";
import { ScheduleRail } from "~~/components/custos/ScheduleRail";

const KEEPER_INTERVAL_SECONDS = 600;
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

const setupSteps = [
  "Create the project with the command above and pick a deployer account.",
  "Get testnet HBAR from the Hedera Portal faucet and testnet USDC from Circle's faucet.",
  "Deploy to Hedera testnet. The deploy script books the first network check.",
  "Start the app and open the Keeper page to watch the schedule run.",
];

const Home: NextPage = () => {
  return (
    <div className="flex grow flex-col">
      <section className="custos-night text-white">
        <div className="mx-auto max-w-6xl px-5 pt-16 pb-14 sm:pt-24">
          <h1 className="max-w-3xl text-[clamp(2.75rem,7vw,5.25rem)] font-normal leading-[1.02] tracking-[-0.02em]">
            Margin kept by the network.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
            Custos is a Scaffold-HBAR template for margin trading on Hedera. Liquidations and funding run on
            Hedera&apos;s own Schedule Service, so there is no keeper bot to host, fund or wake up.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn btn-primary">
              Read the code on GitHub
            </a>
            <Link href="/debug" className="btn btn-ghost text-white hover:bg-white/10">
              Open the contracts
            </Link>
          </div>
          <div className="mt-16 max-w-4xl">
            <ScheduleRail interval={KEEPER_INTERVAL_SECONDS} />
          </div>
        </div>
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
            <h2 className="text-3xl font-normal tracking-[-0.01em]">What the network does every ten minutes</h2>
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
