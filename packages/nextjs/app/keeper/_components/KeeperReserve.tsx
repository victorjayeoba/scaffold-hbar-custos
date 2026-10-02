"use client";

import { KeeperActions } from "./KeeperActions";
import { hbar } from "./format";
import { useKeeperHealth } from "~~/hooks/custos/useKeeperHealth";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

const ONCE = { watch: false, query: { staleTime: Infinity, refetchInterval: false } } as const;
const pct = (bps: bigint) => `${Number(bps) / 100}%`;

/** The HBAR the contract keeps to pay for its own scheduled runs, and how long it lasts. */
export const KeeperReserve = () => {
  const k = useKeeperHealth();
  const { data: maxSwapDeviationBps } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "maxSwapDeviationBps",
    ...ONCE,
  });
  const loaded = k.runsLeft !== undefined;
  const runs = k.runsLeft ?? 0;
  const low = loaded && k.refuelBelow !== undefined && runs > 0 && runs < k.refuelBelow;
  const empty = loaded && runs === 0;
  const target = k.refuelTarget ?? 48;
  const hours = k.interval ? (runs * k.interval) / 3600 : undefined;

  return (
    <section aria-labelledby="reserve-title" className="mx-auto w-full max-w-6xl px-5 pt-16">
      <h2 id="reserve-title" className="text-3xl font-normal tracking-[-0.01em]">
        Fee reserve
      </h2>
      <p className="mt-3 mb-8 max-w-2xl text-base-content/70">
        The contract pays for its own scheduled runs from an HBAR balance. Before a run starts, Hedera must be able to
        charge its full gas limit; afterwards it keeps only what the run used.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <div>
              <div className="text-sm text-base-content/60">In the reserve</div>
              <div className="text-5xl tabular-nums">
                {k.reserve !== undefined ? hbar(k.reserve) : "…"} <span className="text-2xl">HBAR</span>
              </div>
            </div>
            <div className="sm:text-right">
              <div className="text-sm text-base-content/60">Runs it can start</div>
              <div className={`text-5xl tabular-nums ${empty ? "text-error" : ""}`}>
                {loaded ? (Number.isFinite(runs) ? runs : "∞") : "…"}
              </div>
            </div>
          </div>

          <progress
            className={`progress mt-6 h-3 w-full ${empty ? "progress-error" : low ? "progress-warning" : "progress-success"}`}
            value={loaded ? Math.min(runs, target) : undefined}
            max={target}
            aria-label={`Runs the reserve can pay for, out of the ${target}-run refuel target`}
          />
          <div className="mt-1 flex justify-between text-xs text-base-content/55">
            <span>{hours !== undefined && loaded ? `about ${Math.round(hours * 10) / 10} h of checks` : " "}</span>
            <span>refuel target {target} runs</span>
          </div>

          {empty && (
            <div role="alert" className="alert alert-error mt-6 items-start text-left">
              <div>
                <p className="m-0 font-medium">The reserve can&apos;t start a run.</p>
                <p className="mt-1 mb-0 text-sm">
                  Hedera needs {k.holdPerRun !== undefined ? hbar(k.holdPerRun) : "…"} HBAR available up front and the
                  reserve has {k.reserve !== undefined ? hbar(k.reserve) : "…"}. The keeper refuels itself through
                  SaucerSwap, but only from inside a run, so it can&apos;t climb out of this alone. Anyone can top it up
                  with <code>fund()</code>, then revive the chain.
                </p>
              </div>
            </div>
          )}
          {low && (
            <div role="status" className="alert alert-warning mt-6 items-start text-left">
              <div>
                <p className="m-0 font-medium">Running low: {runs} runs left.</p>
                <p className="mt-1 mb-0 text-sm">
                  Below {k.refuelBelow} runs, each check tries to swap spare pool USDC for HBAR on SaucerSwap. On
                  testnet that swap refuses (see below), so top it up here with <code>fund()</code>.
                </p>
              </div>
            </div>
          )}

          <dl className="mt-6 mb-0 divide-y divide-base-300 border-t border-base-300">
            <Row label="Held up front per run">
              {k.holdPerRun !== undefined ? `${hbar(k.holdPerRun)} HBAR` : "…"}
              {k.gasLimit !== undefined && k.gasPrice !== undefined && (
                <span className="block text-xs text-base-content/55">
                  {Number(k.gasLimit).toLocaleString("en-US")} gas × {Number(k.gasPrice)} tinybar, runCostEstimate()
                </span>
              )}
            </Row>
            <Row label="Gas price">
              {k.gasPrice !== undefined ? `${Number(k.gasPrice)} tinybar per gas` : "…"}
              <span className="block text-xs text-base-content/55">
                set at deploy, then recorded by every network run
              </span>
            </Row>
            <Row label="Refuels itself">
              {k.refuelBelow !== undefined ? `Below ${k.refuelBelow} runs` : "…"}
              <span className="block text-xs text-base-content/55">
                pool USDC → HBAR on SaucerSwap
                {maxSwapDeviationBps !== undefined && `, within ${pct(maxSwapDeviationBps)} of the oracle`}
              </span>
            </Row>
          </dl>
          <p className="mt-4 mb-0 text-xs text-base-content/60">
            On testnet the refuel fails closed: SaucerSwap&apos;s testnet HBAR/USDC pool is far from the real price, so
            the swap would fill outside the oracle band and the contract refuses it. The reserve is topped up with{" "}
            <code>fund()</code> instead. Where SaucerSwap tracks the market price, the same swap goes through.
          </p>
        </div>

        <KeeperActions />
      </div>
    </section>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-3">
    <dt className="text-base-content/70">{label}</dt>
    <dd className="m-0 text-right tabular-nums">{children}</dd>
  </div>
);
