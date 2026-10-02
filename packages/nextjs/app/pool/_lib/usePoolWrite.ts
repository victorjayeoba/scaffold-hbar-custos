import type { Abi, Address } from "viem";
import { usePublicClient } from "wagmi";
import { useDeployedContractInfo, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";

type Exit = "withdraw" | "redeem";

/**
 * Pool writes. Each one is simulated first against the live pool, so a call that would revert is stopped before
 * the wallet opens and its custom error reaches the page (mapped to words by poolErrors.ts). Then it goes through
 * the template's transactor, which shows the pending and done toasts with a HashScan link.
 * withdraw and redeem burn the caller's own shares, so they take no `owner` argument.
 */
export const usePoolWrite = (account?: Address) => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { data: pool } = useDeployedContractInfo({ contractName: "LiquidityPool" });
  // We simulate ourselves (below) so the error can be shown in plain words rather than as a raw toast.
  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "LiquidityPool",
    disableSimulate: true,
  });

  const send = async (functionName: "deposit" | Exit, amount: bigint) => {
    if (!publicClient || !pool || !account) throw new Error("Wallet or pool not ready");
    const args = [amount, account] as const;
    await publicClient.simulateContract({ address: pool.address, abi: pool.abi as Abi, account, functionName, args });
    return writeContractAsync({ functionName, args });
  };

  return {
    /** deposit(assets, me): USDC in, shares out. Needs USDC approved to the pool. */
    deposit: (assets: bigint) => send("deposit", assets),
    /** withdraw(assets, me): exact USDC out, the shares it takes are burned. Needs the pool approved on the shares. */
    withdraw: (assets: bigint) => send("withdraw", assets),
    /** redeem(shares, me): exact shares burned, USDC out at the share price. Needs the pool approved on the shares. */
    redeem: (shares: bigint) => send("redeem", shares),
    isMining,
  };
};
