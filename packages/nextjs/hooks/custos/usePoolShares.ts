import { type Address, zeroAddress } from "viem";
import { POLL } from "~~/hooks/custos/poll";
import { useHtsToken } from "~~/hooks/custos/useHtsToken";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

/**
 * The pool's LP share token: a native HTS token the pool created (`shareToken()`). LPs must be associated with it to
 * receive shares, and must approve the pool on it before `redeem` / `withdraw`, which burn shares from the caller.
 */
export const usePoolShares = (owner?: Address) => {
  const { data: pool } = useDeployedContractInfo({ contractName: "LiquidityPool" });
  const { data: shareTokenAddress } = useScaffoldReadContract({
    contractName: "LiquidityPool",
    functionName: "shareToken",
    ...POLL,
  });

  // The pool returns the zero address until its owner calls createShareToken().
  const notCreated = shareTokenAddress === zeroAddress;
  const token = useHtsToken({ token: notCreated ? undefined : shareTokenAddress, owner, spender: pool?.address });

  return {
    ...token,
    /** The share token hasn't been created yet: no deposits until it is. */
    notCreated,
  };
};

export type PoolShares = ReturnType<typeof usePoolShares>;
