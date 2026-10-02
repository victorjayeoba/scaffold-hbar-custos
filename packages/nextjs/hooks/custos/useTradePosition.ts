import { Address } from "viem";
import { POLL } from "~~/hooks/custos/poll";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { Position } from "~~/utils/custos/perpMath";

/**
 * One trader's position and the contract's own view of it: funding owed and liquidation price, both at the current
 * funding index. PnL and equity at the mark price are derived with perpMath (the same formulas as `pnl`/`equity`),
 * so they move with the price without another round trip.
 */
export const useTradePosition = (trader?: Address) => {
  const enabled = !!trader;
  const args = [trader] as const;

  const position = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "positionOf",
    args,
    ...POLL,
    query: { ...POLL.query, enabled },
  });
  const { data: owed } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "fundingOwed",
    args,
    ...POLL,
    query: { ...POLL.query, enabled },
  });
  const { data: liquidationPrice } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "liquidationPrice",
    args,
    ...POLL,
    query: { ...POLL.query, enabled },
  });

  const p = position.data as Position | undefined;
  return {
    /** Undefined while loading; `size === 0n` means no position. */
    position: p,
    hasPosition: p !== undefined && p.size !== 0n,
    fundingOwed: owed,
    liquidationPrice,
    isLoading: enabled && position.isLoading,
    error: position.error,
    refetch: position.refetch,
  };
};
