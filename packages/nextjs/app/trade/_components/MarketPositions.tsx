"use client";

import { fmtBps, fmtPrice, fmtSize, fmtUsdc, shortAddress } from "../_lib/format";
import { Skeleton } from "./MarketHeader";
import { Abi, Address } from "viem";
import { useReadContracts } from "wagmi";
import { POLL } from "~~/hooks/custos/poll";
import type { TradeMarket } from "~~/hooks/custos/useTradeMarket";
import { useDeployedContractInfo, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import {
  CONTRACT_DEFAULTS,
  Position,
  distanceToLiquidationBps,
  equity,
  maintenanceMargin,
  openedLeverage,
} from "~~/utils/custos/perpMath";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/** Matches the keeper's sweep page (PerpMarket.PAGE_SIZE), so the list shows what one network check looks at. */
const SHOWN = 50;

/** Every open position on the market, read live. Anyone can watch margin move here, no wallet needed. */
export const MarketPositions = ({ market, me }: { market: TradeMarket; me?: Address }) => {
  const { targetNetwork } = useTargetNetwork();
  const { data: perp } = useDeployedContractInfo({ contractName: "PerpMarket" });
  const count = market.traderCount !== undefined ? Math.min(Number(market.traderCount), SHOWN) : 0;
  const base = { address: perp?.address, abi: perp?.abi as Abi, chainId: targetNetwork.id } as const;

  const tradersRead = useReadContracts({
    allowFailure: true,
    contracts: Array.from({ length: count }, (_, i) => ({ ...base, functionName: "traders", args: [BigInt(i)] })),
    query: { enabled: !!perp && count > 0, ...POLL.query },
  });
  const traders = (tradersRead.data ?? [])
    .map(r => (r.status === "success" ? (r.result as Address) : undefined))
    .filter((a): a is Address => !!a);

  const detailRead = useReadContracts({
    allowFailure: true,
    contracts: traders.flatMap(t => [
      { ...base, functionName: "positionOf", args: [t] },
      { ...base, functionName: "fundingOwed", args: [t] },
      { ...base, functionName: "liquidationPrice", args: [t] },
    ]),
    query: { enabled: !!perp && traders.length > 0, ...POLL.query },
  });

  const params = market.params ?? CONTRACT_DEFAULTS;
  const mark = market.guard?.price ?? 0n;
  const rows = traders
    .map((trader, i) => {
      const d = detailRead.data;
      const p = d?.[i * 3]?.result as Position | undefined;
      const owed = d?.[i * 3 + 1]?.result as bigint | undefined;
      const liq = d?.[i * 3 + 2]?.result as bigint | undefined;
      if (!p || p.size === 0n || owed === undefined || liq === undefined) return undefined;
      const isLong = p.size > 0n;
      const eq = mark > 0n ? equity(p, mark, owed) : undefined;
      const mm = maintenanceMargin(p.entryNotional, params);
      return {
        trader,
        isLong,
        lev: openedLeverage(p, params),
        size: p.size,
        entry: p.entryPrice,
        liq,
        distance: distanceToLiquidationBps(isLong, mark, liq),
        equity: eq,
        underwater: eq !== undefined && eq < mm,
      };
    })
    .filter(r => r !== undefined);

  const loading =
    market.traderCount === undefined || (count > 0 && (tradersRead.isLoading || detailRead.isLoading) && !rows.length);
  const total = market.traderCount !== undefined ? Number(market.traderCount) : undefined;

  return (
    <section aria-labelledby="positions-heading" className="rounded-box border border-base-300 bg-base-100 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="positions-heading" className="m-0 text-2xl font-normal">
          Open positions on this market
        </h2>
        <span className="text-sm text-base-content/60">
          {total === undefined ? "" : total > SHOWN ? `First ${SHOWN} of ${total}` : `${total} open`} · read live, no
          wallet needed
        </span>
      </div>
      <p className="mt-2 mb-4 max-w-3xl text-sm text-base-content/70">
        Every position the network checks on its schedule. When the mark crosses a liquidation price, the next check
        closes that position and its collateral goes to the pool.
      </p>

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading positions">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="m-0 text-base-content/70">No open positions right now. Be the first.</p>
      ) : (
        <>
          {/* Wide screens: a table */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b border-base-300 text-left text-base-content/60">
                <th className="py-2 font-normal">Trader</th>
                <th className="py-2 font-normal">Side</th>
                <th className="py-2 text-right font-normal">Size (HBAR)</th>
                <th className="py-2 text-right font-normal">Entry</th>
                <th className="py-2 text-right font-normal">Liquidates at</th>
                <th className="py-2 text-right font-normal">Distance</th>
                <th className="py-2 text-right font-normal">Equity (USDC)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.trader} className="border-b border-base-300 last:border-0">
                  <td className="py-2">
                    <TraderLink
                      address={r.trader}
                      me={me}
                      href={getBlockExplorerAddressLink(targetNetwork, r.trader)}
                    />
                  </td>
                  <td className="py-2">
                    <Side isLong={r.isLong} lev={r.lev} />
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtSize(r.size)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtPrice(r.entry)}</td>
                  <td className="py-2 text-right tabular-nums">{r.liq > 0n ? fmtPrice(r.liq) : "None"}</td>
                  <td className={`py-2 text-right tabular-nums ${r.underwater ? "text-error" : ""}`}>
                    {r.underwater ? "Under margin" : r.distance !== undefined ? fmtBps(r.distance) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtUsdc(r.equity, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Narrow screens: one card per position */}
          <ul className="m-0 list-none space-y-2 p-0 md:hidden">
            {rows.map(r => (
              <li key={r.trader} className="rounded-box border border-base-300 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <TraderLink address={r.trader} me={me} href={getBlockExplorerAddressLink(targetNetwork, r.trader)} />
                  <Side isLong={r.isLong} lev={r.lev} />
                </div>
                <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  <dt className="text-base-content/60">Size</dt>
                  <dd className="m-0 text-right tabular-nums">{fmtSize(r.size)} HBAR</dd>
                  <dt className="text-base-content/60">Entry</dt>
                  <dd className="m-0 text-right tabular-nums">{fmtPrice(r.entry)}</dd>
                  <dt className="text-base-content/60">Liquidates at</dt>
                  <dd className="m-0 text-right tabular-nums">
                    {r.liq > 0n ? fmtPrice(r.liq) : "None"}
                    <span className={`ml-1 text-xs ${r.underwater ? "text-error" : "text-base-content/60"}`}>
                      {r.underwater ? "under margin" : r.distance !== undefined ? `(${fmtBps(r.distance)})` : ""}
                    </span>
                  </dd>
                  <dt className="text-base-content/60">Equity</dt>
                  <dd className="m-0 text-right tabular-nums">{fmtUsdc(r.equity, 4)} USDC</dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

const TraderLink = ({ address, me, href }: { address: Address; me?: Address; href: string }) => (
  <a href={href} target="_blank" rel="noreferrer" className="link font-mono">
    {shortAddress(address)}
    {me && me.toLowerCase() === address.toLowerCase() && <span className="ml-1 font-sans text-primary">(you)</span>}
  </a>
);

const Side = ({ isLong, lev }: { isLong: boolean; lev?: bigint }) => (
  <span className={isLong ? "text-success-content dark:text-success" : "text-error-content dark:text-error"}>
    {isLong ? "LONG" : "SHORT"}
    {lev ? ` ${lev}x` : ""}
  </span>
);
