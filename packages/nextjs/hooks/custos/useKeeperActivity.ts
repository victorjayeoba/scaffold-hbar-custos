import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type DecodeEventLogReturnType, type Hex, decodeEventLog } from "viem";
import { POLL } from "~~/hooks/custos/poll";
import { useDeployedContractInfo, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { chainIdToHederaNetwork } from "~~/utils/scaffold-hbar";
import type { ContractAbi } from "~~/utils/scaffold-hbar/contract";

type MarketAbi = ContractAbi<"PerpMarket">;
export type MarketEvent = DecodeEventLogReturnType<MarketAbi>;

/** One Hedera transaction that touched the keeper, with the PerpMarket events it emitted (in order). */
export type KeeperEntry = {
  /** Consensus timestamp ("seconds.nanos"). HashScan opens a transaction by it. */
  timestamp: string;
  events: MarketEvent[];
  /** True when the Schedule Service executed it: nobody signed it at that moment. Undefined if unknown. */
  scheduled?: boolean;
  /** "SUCCESS" or a Hedera response code such as INSUFFICIENT_PAYER_BALANCE. */
  result?: string;
  /** Fee in tinybars the contract paid from its own reserve. */
  feePaidByContract?: bigint;
};

/** Events emitted by the keeper itself or by actions on it. A transaction with none of these is a trader's. */
const KEEPER_EVENTS = new Set([
  "Ticked",
  "Swept",
  "SweepSkipped",
  "Liquidated",
  "Refueled",
  "Revived",
  "ScheduleFailed",
  "Funded",
  "Stopped",
  "TickScheduled",
]);

type MirrorLog = { data: string; topics: string[]; index: number; timestamp: string };
type MirrorTx = {
  consensus_timestamp: string;
  result: string;
  scheduled: boolean;
  transfers: { account: string; amount: number }[];
};

const PAGE = 100;

/** Mirror node and HashScan for the app's target network. */
export const useHederaLinks = () => {
  const { targetNetwork } = useTargetNetwork();
  const net = chainIdToHederaNetwork(targetNetwork.id);
  return { mirror: `https://${net}.mirrornode.hedera.com/api/v1`, hashscan: `https://hashscan.io/${net}` };
};

/** `0.0.N` for a long-zero address (schedules, system accounts); undefined for a normal EVM address. */
export const hederaIdOf = (address: string) => {
  const n = BigInt(address);
  return n > 0n && n < 2n ** 64n ? `0.0.${n}` : undefined;
};

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The mirror node answered ${res.status}`);
  return res.json();
};

/**
 * One page of keeper activity at or before `before`. Logs come from the mirror node (the public RPC limits
 * eth_getLogs ranges); the transactions in the same window say which runs the Schedule Service executed, who paid,
 * and which booked runs failed (a failed run reverts, so it leaves no log).
 */
const fetchPage = async (mirror: string, contractId: string, abi: MarketAbi, before?: string) => {
  const upper = before ? `&timestamp=lte:${before}` : "";
  const { logs } = await getJson<{ logs: MirrorLog[] }>(
    `${mirror}/contracts/${contractId}/results/logs?order=desc&limit=${PAGE}${upper}`,
  );

  // A full page may end halfway through a transaction: hand that transaction to the next page whole.
  let next: string | undefined;
  let kept = logs;
  const oldest = logs.at(-1)?.timestamp;
  // ponytail: a single transaction with 100+ logs ends paging here; a sweep emits ~25 at most (PAGE_SIZE = 20).
  if (logs.length === PAGE && oldest !== logs[0].timestamp) {
    next = oldest;
    kept = logs.filter(log => log.timestamp !== oldest);
  }

  const lower = next ? `&timestamp=gt:${next}` : "";
  const { transactions } = await getJson<{ transactions: MirrorTx[] }>(
    `${mirror}/transactions?account.id=${contractId}&transactiontype=CONTRACTCALL&order=desc&limit=${PAGE}${upper}${lower}`,
  );

  const byTime = new Map<string, KeeperEntry & { indexed: [number, MarketEvent][] }>();
  const entryAt = (timestamp: string) => {
    let entry = byTime.get(timestamp);
    if (!entry) byTime.set(timestamp, (entry = { timestamp, events: [], indexed: [] }));
    return entry;
  };

  for (const log of kept) {
    try {
      const event = decodeEventLog({ abi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] });
      entryAt(log.timestamp).indexed.push([log.index, event]);
    } catch {
      // Not a PerpMarket event (or an older ABI); skip it.
    }
  }

  for (const tx of transactions) {
    const known = byTime.has(tx.consensus_timestamp);
    const failedRun = tx.scheduled && tx.result !== "SUCCESS";
    if (!known && !failedRun) continue;
    const entry = entryAt(tx.consensus_timestamp);
    entry.scheduled = tx.scheduled;
    entry.result = tx.result;
    const paid = tx.transfers.find(t => t.account === contractId && t.amount < 0);
    if (paid) entry.feePaidByContract = BigInt(-paid.amount);
  }

  const entries: KeeperEntry[] = [...byTime.values()]
    .map(({ indexed, ...entry }) => ({
      ...entry,
      events: indexed.sort((a, b) => a[0] - b[0]).map(([, event]) => event),
    }))
    .filter(e => e.events.some(ev => KEEPER_EVENTS.has(ev.eventName)) || (e.scheduled && e.result !== "SUCCESS"))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { entries, next };
};

/** The keeper's history, newest first, read from the Hedera mirror node and decoded against PerpMarket's ABI. */
export const useKeeperActivity = () => {
  const { mirror } = useHederaLinks();
  const { data: market, isLoading: marketLoading } = useDeployedContractInfo({ contractName: "PerpMarket" });
  const missing = !marketLoading && !market ? new Error("PerpMarket is not deployed on this network.") : null;

  // The mirror node indexes logs by Hedera id, so look it up from the deployed address (it changes on redeploy).
  const contract = useQuery({
    queryKey: ["custos", "mirror-contract-id", mirror, market?.address],
    enabled: Boolean(market),
    staleTime: Infinity,
    queryFn: async () => (await getJson<{ contract_id: string }>(`${mirror}/contracts/${market!.address}`)).contract_id,
  });

  const feed = useInfiniteQuery({
    queryKey: ["custos", "keeper-activity", mirror, contract.data],
    enabled: Boolean(contract.data && market),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPage(mirror, contract.data!, market!.abi, pageParam),
    getNextPageParam: last => last.next,
    refetchInterval: POLL.query.refetchInterval,
  });

  return {
    contractId: contract.data,
    entries: feed.data?.pages.flatMap(page => page.entries),
    error: missing ?? contract.error ?? feed.error,
    isLoading: !missing && (!market || contract.isPending || feed.isPending),
    hasMore: feed.hasNextPage,
    loadMore: feed.fetchNextPage,
    isLoadingMore: feed.isFetchingNextPage,
    retry: () => (contract.error ? contract.refetch() : feed.refetch()),
  };
};
