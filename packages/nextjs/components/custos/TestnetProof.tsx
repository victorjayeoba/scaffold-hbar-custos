"use client";

import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useKeeper } from "~~/hooks/custos/useKeeper";
import { TESTNET_NOTES_URL, testnetProof } from "~~/utils/custos/testnet";

/** "Verified on Hedera testnet": every row opens on HashScan. The last row is read live from the keeper. */
export const TestnetProof = () => {
  const { runCount, runsLeft } = useKeeper();

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-2xl font-normal">Verified on Hedera testnet</h2>
        <a href={TESTNET_NOTES_URL} target="_blank" rel="noreferrer" className="link text-sm text-base-content/70">
          Read the testnet notes
        </a>
      </div>
      <ul className="mt-6 mb-0 list-none divide-y divide-base-300 p-0">
        {testnetProof.map(row => (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
            <span>{row.label}</span>
            <a
              href={row.href}
              target="_blank"
              rel="noreferrer"
              title={row.id}
              className="link inline-flex items-center gap-1 font-mono text-sm text-primary"
            >
              {row.id.length > 24 ? `${row.id.slice(0, 8)}…${row.id.slice(-6)}` : row.id}
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden />
            </a>
          </li>
        ))}
        <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
          <span>Checks the network has run so far</span>
          <span className="text-sm tabular-nums text-base-content/80">
            {runCount === undefined
              ? "Reading the keeper…"
              : `${runCount} run${runCount === 1 ? "" : "s"}, ${runsLeft ?? "…"} more paid for`}
          </span>
        </li>
      </ul>
    </div>
  );
};
