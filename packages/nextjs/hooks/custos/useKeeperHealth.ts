import { useBalance, useGasPrice } from "wagmi";
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
 * and whether the reserve can actually pay for the next run.
 *
 * Hedera must be able to charge a scheduled call's full gas limit up front (gasLimit × gas price), or the call fails
 * with INSUFFICIENT_PAYER_BALANCE and the chain breaks. The contract's own `runsLeft()` divides by the average cost
 * instead, so it can still say "3" when no run can start. `runsLeft` here counts runs that can actually start.
 */
export const useKeeperHealth = () => {
  const now = useNow();
  const keeper = useKeeper();
  const { targetNetwork } = useTargetNetwork();
  const { data: market } = useDeployedContractInfo({ contractName: "PerpMarket" });
  const refetch = { refetchInterval: POLL.query.refetchInterval };

  const { data: balance } = useBalance({ address: market?.address, chainId: targetNetwork.id, query: refetch });
  const { data: gasPrice } = useGasPrice({ chainId: targetNetwork.id, query: refetch });
  const { data: gasLimit } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "gasLimit", ...POLL });
  const { data: runCost } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "runCostEstimate",
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
  const holdPerRun =
    gasLimit !== undefined && gasPrice !== undefined ? (gasLimit * gasPrice) / WEIBAR_PER_TINYBAR : undefined;
  let runsLeft: number | undefined;
  if (reserve !== undefined && holdPerRun !== undefined && runCost !== undefined) {
    if (reserve < holdPerRun) runsLeft = 0;
    else runsLeft = runCost === 0n ? Infinity : Number((reserve - holdPerRun) / runCost) + 1;
  }
  /** Tinybars to add so `runs` runs in a row can start. */
  const topUpFor = (runs: number) => {
    if (reserve === undefined || holdPerRun === undefined || runCost === undefined) return undefined;
    const missing = holdPerRun + runCost * BigInt(Math.max(runs - 1, 0)) - reserve;
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
    holdPerRun,
    runCost,
    gasLimit,
    gasPrice,
    runsLeft,
    contractRunsLeft: keeper.runsLeft,
    canPayNextRun: runsLeft === undefined ? undefined : runsLeft > 0,
    refuelBelow: refuelBelow !== undefined ? Number(refuelBelow) : undefined,
    refuelTarget: refuelTarget !== undefined ? Number(refuelTarget) : undefined,
    topUpFor,
  };
};

export type KeeperHealth = ReturnType<typeof useKeeperHealth>;
