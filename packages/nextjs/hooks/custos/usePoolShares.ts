import { type Abi, type Address, zeroAddress } from "viem";
import { useReadContract } from "wagmi";
import { POLL } from "~~/hooks/custos/poll";
import { useHtsToken } from "~~/hooks/custos/useHtsToken";
import { useDeployedContractInfo, useTargetNetwork } from "~~/hooks/scaffold-hbar";

const shareTokenAbi = [
  {
    type: "function",
    name: "shareToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

const hasFunction = (abi: Abi | undefined, name: string) =>
  !!abi?.some(item => item.type === "function" && item.name === name);

/**
 * The pool's LP share token, whichever shape the deployed pool has:
 *
 * - **HTS shares** (the pool exposes `shareToken()`): shares are a native HTS token the pool created. LPs must be
 *   associated with it to receive shares, and must approve the pool on it before `redeem` / `withdraw`.
 * - **ERC-4626 shares** (no `shareToken()`): the pool contract is the share token. Nothing to associate, and no
 *   approval, since the pool burns its own shares from `msg.sender`.
 *
 * The switch reads the ABI in deployedContracts.ts, so a redeploy with the new pool flips it with no page changes.
 */
export const usePoolShares = (owner?: Address) => {
  const { targetNetwork } = useTargetNetwork();
  const { data: pool } = useDeployedContractInfo({ contractName: "LiquidityPool" });
  const separateToken = hasFunction(pool?.abi as Abi | undefined, "shareToken");

  const { data: shareTokenAddress } = useReadContract({
    address: pool?.address,
    abi: shareTokenAbi,
    functionName: "shareToken",
    chainId: targetNetwork.id,
    query: { enabled: separateToken && !!pool, ...POLL.query },
  });

  // The HTS pool returns the zero address until its owner calls createShareToken().
  const notCreated = separateToken && shareTokenAddress === zeroAddress;
  const tokenAddress = separateToken ? (notCreated ? undefined : shareTokenAddress) : pool?.address;
  const token = useHtsToken({ token: tokenAddress, owner, spender: pool?.address });

  return {
    ...token,
    /** True when shares live in their own (HTS) token rather than on the pool contract. */
    separateToken,
    /** The pool uses an HTS share token but it hasn't been created yet: no deposits until it is. */
    notCreated,
    /** True when the pool must be approved on the share token before shares can be redeemed. */
    needsExitApproval: separateToken,
  };
};

export type PoolShares = ReturnType<typeof usePoolShares>;
