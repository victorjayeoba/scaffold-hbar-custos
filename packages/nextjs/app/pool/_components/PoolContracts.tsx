"use client";

import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import type { PoolState } from "~~/hooks/custos/usePool";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";

/** The on-chain pieces behind this page, each opening on HashScan. */
export const PoolContracts = ({ pool }: { pool: PoolState }) => {
  const { targetNetwork } = useTargetNetwork();
  const explorer = targetNetwork.blockExplorers?.default.url ?? "https://hashscan.io/testnet";

  const rows = [
    {
      label: "LiquidityPool (ERC-4626 vault)",
      id: pool.poolAddress,
      href: pool.poolAddress && `${explorer}/contract/${pool.poolAddress}`,
    },
    {
      label: "USDC, the pool's asset (HTS token)",
      id: pool.usdc.tokenId ?? pool.usdc.address,
      href: pool.usdc.address && `${explorer}/token/${pool.usdc.tokenId ?? pool.usdc.address}`,
    },
    pool.shares.separateToken
      ? {
          label: `${pool.shares.symbol ?? "cUSDC-LP"}, the LP share (HTS token)`,
          id: pool.shares.tokenId ?? pool.shares.address,
          href: pool.shares.address && `${explorer}/token/${pool.shares.tokenId ?? pool.shares.address}`,
        }
      : {
          label: `${pool.shares.symbol ?? "cUSDC-LP"}, the LP share (ERC-20 on the pool contract)`,
          id: pool.poolAddress,
          href: pool.poolAddress && `${explorer}/contract/${pool.poolAddress}`,
        },
  ];

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
      <h2 className="m-0 text-2xl font-normal">On chain</h2>
      <ul className="mt-4 mb-0 list-none divide-y divide-base-300 p-0">
        {rows.map(row => (
          <li key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
            <span>{row.label}</span>
            {row.href ? (
              <a
                href={row.href}
                target="_blank"
                rel="noreferrer"
                className="link inline-flex min-w-0 items-center gap-1 break-all font-mono text-sm text-primary"
              >
                {row.id}
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : (
              <span className="text-sm text-base-content/60">Reading…</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
