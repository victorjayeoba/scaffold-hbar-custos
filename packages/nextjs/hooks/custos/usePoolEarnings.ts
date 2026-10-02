import { useQuery } from "@tanstack/react-query";
import { type Abi, type Address, type Hex, decodeEventLog } from "viem";
import { POLL } from "~~/hooks/custos/poll";
import { mirrorNodeUrl } from "~~/hooks/custos/useHtsToken";
import { useDeployedContractInfo, useTargetNetwork } from "~~/hooks/scaffold-hbar";

/**
 * Where the pool's USDC came from and went, rebuilt from PerpMarket and LiquidityPool events on the mirror node.
 *
 * Every USDC movement in or out of the pool has an event:
 * - Opened.fee                     → the open fee, paid to the pool
 * - Closed                         → the market keeps `collateral` and pays `payout`; the pool takes or covers the rest
 *                                    (`fee` of it is the close fee, the remainder is trader loss or profit incl. funding)
 * - Liquidated                     → the position's collateral, minus any caller reward, goes to the pool
 * - LiquidityPool.KeeperPaid       → USDC the pool paid the keeper, swapped to HBAR to fund the network's runs
 * - LiquidityPool.Deposit/Withdraw → LP money in and out
 *
 * A position's collateral isn't in the Liquidated or Closed events, so it's tracked from Opened + CollateralAdded.
 */

type MirrorLog = { data: Hex; topics: Hex[]; timestamp: string; index: number; transaction_hash: string };
type MirrorPage = { logs: MirrorLog[]; links?: { next?: string | null } };

/** Stop after this many pages (100 logs each) so a busy market can't stall the page. */
const MAX_PAGES = 30;

export type PoolFlow = {
  kind: "fee" | "settled" | "liquidation" | "keeper" | "deposit" | "withdraw";
  amount: bigint; // signed, from the pool's point of view (USDC, 6 dp)
  timestamp: string; // consensus timestamp, also a HashScan transaction id
  trader?: Address;
  byNetwork?: boolean;
};

export type PoolEarnings = {
  fees: bigint;
  settled: bigint;
  liquidations: bigint;
  keeperPaid: bigint;
  deposited: bigint;
  withdrawn: bigint;
  /** fees + settled + liquidations − keeperPaid */
  net: bigint;
  flows: PoolFlow[]; // newest first, LP deposits and withdrawals included
  /** True if history was cut at MAX_PAGES, so totals cover only part of it. */
  truncated: boolean;
  /** Liquidations or closes whose opening we didn't see, so their amount is unknown (counted as 0). */
  unmatched: number;
};

const fetchLogs = async (mirror: string, address: string) => {
  const logs: MirrorLog[] = [];
  let next: string | null | undefined = `/api/v1/contracts/${address}/results/logs?order=asc&limit=100`;
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    const res = await fetch(`${mirror}${next}`);
    if (!res.ok) throw new Error(`Mirror node answered ${res.status}`);
    const page = (await res.json()) as MirrorPage;
    logs.push(...page.logs);
    next = page.links?.next;
    pages++;
  }
  return { logs, truncated: !!next };
};

type Decoded = { name: string; args: Record<string, unknown>; log: MirrorLog; source: "market" | "pool" };

const decodeAll = (logs: MirrorLog[], abi: Abi, source: Decoded["source"]) =>
  logs.flatMap(log => {
    try {
      const { eventName, args } = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      return [{ name: String(eventName), args: args as unknown as Record<string, unknown>, log, source }];
    } catch {
      return []; // an event this ABI doesn't know (e.g. from an older deploy)
    }
  });

/** Pure: turns decoded market and pool events into the pool's income statement. Exported for tests. */
export const summarise = (events: Decoded[], truncated: boolean): PoolEarnings => {
  // Consensus timestamps ("seconds.nanos", nanos zero-padded to 9) sort as strings; ties are one transaction,
  // ordered by log index.
  const sorted = [...events].sort((a, b) =>
    a.log.timestamp === b.log.timestamp ? a.log.index - b.log.index : a.log.timestamp < b.log.timestamp ? -1 : 1,
  );
  const collateral = new Map<string, bigint>();
  const out: PoolEarnings = {
    fees: 0n,
    settled: 0n,
    liquidations: 0n,
    keeperPaid: 0n,
    deposited: 0n,
    withdrawn: 0n,
    net: 0n,
    flows: [],
    truncated,
    unmatched: 0,
  };
  const flow = (f: PoolFlow) => out.flows.push(f);

  for (const { name, args, log, source } of sorted) {
    const at = log.timestamp;
    if (source === "market") {
      const trader = (args.trader as Address | undefined)?.toLowerCase();
      if (name === "Opened" && trader) {
        const fee = args.fee as bigint;
        collateral.set(trader, args.collateral as bigint);
        out.fees += fee;
        flow({ kind: "fee", amount: fee, timestamp: at, trader: args.trader as Address });
      } else if (name === "CollateralAdded" && trader) {
        collateral.set(trader, (collateral.get(trader) ?? 0n) + (args.amount as bigint));
      } else if (name === "Closed" && trader) {
        const held = collateral.get(trader);
        collateral.delete(trader);
        const fee = args.fee as bigint;
        if (held === undefined) {
          out.unmatched++;
          continue;
        }
        const toPool = held - (args.payout as bigint); // negative: the pool paid the trader's profit
        // The close fee is inside `toPool` only if equity covered it; when the payout floors at 0 it may not be.
        const feePart = toPool >= fee ? fee : toPool > 0n ? toPool : 0n;
        out.fees += feePart;
        out.settled += toPool - feePart;
        flow({ kind: "settled", amount: toPool, timestamp: at, trader: args.trader as Address });
      } else if (name === "Liquidated" && trader) {
        const held = collateral.get(trader);
        collateral.delete(trader);
        if (held === undefined) {
          out.unmatched++;
          continue;
        }
        const reward = args.reward as bigint;
        const toPool = held > reward ? held - reward : 0n;
        out.liquidations += toPool;
        flow({
          kind: "liquidation",
          amount: toPool,
          timestamp: at,
          trader: args.trader as Address,
          byNetwork: args.byNetwork as boolean,
        });
      }
    } else {
      if (name === "KeeperPaid") {
        const amount = args.amount as bigint;
        out.keeperPaid += amount;
        flow({ kind: "keeper", amount: -amount, timestamp: at, byNetwork: true });
      } else if (name === "Deposit") {
        out.deposited += args.assets as bigint;
        flow({
          kind: "deposit",
          amount: args.assets as bigint,
          timestamp: at,
          trader: (args.owner ?? args.receiver) as Address,
        });
      } else if (name === "Withdraw") {
        out.withdrawn += args.assets as bigint;
        flow({
          kind: "withdraw",
          amount: -(args.assets as bigint),
          timestamp: at,
          trader: (args.owner ?? args.sender) as Address,
        });
      }
    }
  }

  out.net = out.fees + out.settled + out.liquidations - out.keeperPaid;
  out.flows.reverse();
  return out;
};

export const usePoolEarnings = () => {
  const { targetNetwork } = useTargetNetwork();
  const { data: market } = useDeployedContractInfo({ contractName: "PerpMarket" });
  const { data: pool } = useDeployedContractInfo({ contractName: "LiquidityPool" });

  return useQuery({
    queryKey: ["custos", "pool-earnings", targetNetwork.id, market?.address, pool?.address],
    enabled: !!market && !!pool,
    queryFn: async () => {
      const mirror = mirrorNodeUrl(targetNetwork.id);
      const [m, p] = await Promise.all([fetchLogs(mirror, market!.address), fetchLogs(mirror, pool!.address)]);
      const events = [
        ...decodeAll(m.logs, market!.abi as Abi, "market"),
        ...decodeAll(p.logs, pool!.abi as Abi, "pool"),
      ];
      return summarise(events, m.truncated || p.truncated);
    },
    ...POLL.query,
  });
};
