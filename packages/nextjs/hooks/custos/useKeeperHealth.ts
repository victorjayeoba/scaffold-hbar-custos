import { useBalance } from "wagmi";
import { POLL } from "~~/hooks/custos/poll";
import { useKeeper } from "~~/hooks/custos/useKeeper";
import { useNow } from "~~/hooks/custos/useNow";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";

/** Wei-style JSON-RPC values (18 decimals) to tinybars (8 decimals). */
const WEIBAR_PER_TINYBAR = 10n ** 10n;
/** After `nextRunAt`, how long before the page stops saying "due" and starts saying "late". */
const DUE_GRACE_SECONDS = 120;

export type KeeperState = "loading" | "scheduled" | "due" | "late" | "overdue" | "stopped";

/**
 * Everything the keeper page needs to judge the chain of scheduled runs: the schedule, the HBAR fee reserve,
 * and whether the reserve can pay for the next run.
 *
 * Hedera only starts a scheduled call if the payer holds its full gas limit at the gas price (gasLimit × gasPrice),
 * or the call fails with INSUFFICIENT_PAYER_BALANCE and the chain breaks. The contract accounts for that itself:
 * `runCostEstimate()` is that hold, `runsLeft()` counts whole holds and `canPayNextRun()` checks the next one.
 */
export const useKeeperHealth = () => {
  const now = useNow();
  const keeper = useKeeper();
  const { targetNetwork } = useTargetNetwork();
  const { data: market } = useDeployedContractInfo({ contractName: "PerpMarket" });

  const { data: balance } = useBalance({
    address: market?.address,
    chainId: targetNetwork.id,
    query: { refetchInterval: POLL.query.refetchInterval },
  });
  const { data: gasLimit } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "gasLimit", ...POLL });
  const { data: gasPrice } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "gasPrice", ...POLL });
  const { data: holdPerRun } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "runCostEstimate",
    ...POLL,
  });
  const { data: canPayNextRun } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "canPayNextRun",
    ...POLL,
  });
  const { data: refuelBelow } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "REFUEL_BELOW_RUNS",
    ...POLL,
  });
  const { data: refuelTarget } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "REFUEL_TARGET_RUNS",
    ...POLL,
  });

  // All HBAR amounts below are in tinybars.
  const reserve = balance ? balance.value / WEIBAR_PER_TINYBAR : undefined;
  // With no gas price yet the contract returns uint256 max: no run is counted as costing anything.
  const runsLeft = holdPerRun === 0n ? Infinity : keeper.runsLeft;
  /** Tinybars to add so the contract's `runsLeft()` reaches `runs`: it counts whole holds, balance / hold. */
  const topUpFor = (runs: number) => {
    if (reserve === undefined || holdPerRun === undefined) return undefined;
    const missing = holdPerRun * BigInt(runs) - reserve;
    return missing > 0n ? missing : 0n;
  };

  let state: KeeperState = "loading";
  const { nextRunAt, interval } = keeper;
  if (keeper.loaded && now !== undefined && nextRunAt !== undefined && interval !== undefined) {
    if (nextRunAt === 0) state = "stopped";
    else if (now < nextRunAt) state = "scheduled";
    else if (now <= nextRunAt + DUE_GRACE_SECONDS) state = "due";
    else if (now <= nextRunAt + 2 * interval) state = "late";
    else state = "overdue";
  }

  return {
    ...keeper,
    now,
    state,
    /** `revive()` only succeeds when the chain is stopped or more than two intervals late. */
    canRevive: state === "overdue" || state === "stopped",
    /** When `revive()` opens (unix seconds); undefined while stopped or loading. */
    reviveOpensAt: nextRunAt && interval ? nextRunAt + 2 * interval : undefined,
    reserve,
    /** `runCostEstimate()`: tinybars Hedera must be able to hold before a run starts, gasLimit × gasPrice. */
    holdPerRun,
    gasLimit,
    /** Tinybars per gas, as the last network run recorded it (`gasPrice()`). */
    gasPrice,
    runsLeft,
    canPayNextRun,
    refuelBelow: refuelBelow !== undefined ? Number(refuelBelow) : undefined,
    refuelTarget: refuelTarget !== undefined ? Number(refuelTarget) : undefined,
    topUpFor,
  };
};

export type KeeperHealth = ReturnType<typeof useKeeperHealth>;
