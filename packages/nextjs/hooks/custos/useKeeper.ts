import { POLL } from "~~/hooks/custos/poll";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

/** The keeper's schedule, read from PerpMarket (ScheduledKeeper) on Hedera testnet. */
export const useKeeper = () => {
  const { data: nextRunAt } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "nextRunAt",
    ...POLL,
  });
  const { data: lastRunAt } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "lastRunAt",
    ...POLL,
  });
  const { data: interval } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "interval", ...POLL });
  const { data: runCount } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "runCount", ...POLL });
  const { data: runsLeft } = useScaffoldReadContract({ contractName: "PerpMarket", functionName: "runsLeft", ...POLL });
  const { data: nextSchedule } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "nextSchedule",
    ...POLL,
  });

  const loaded = nextRunAt !== undefined && interval !== undefined && runCount !== undefined;
  return {
    loaded,
    nextRunAt: nextRunAt !== undefined ? Number(nextRunAt) : undefined,
    lastRunAt: lastRunAt !== undefined ? Number(lastRunAt) : undefined,
    interval: interval !== undefined ? Number(interval) : undefined,
    runCount: runCount !== undefined ? Number(runCount) : undefined,
    runsLeft: runsLeft !== undefined ? Number(runsLeft) : undefined,
    nextSchedule,
  };
};
