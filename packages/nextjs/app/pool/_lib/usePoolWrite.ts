import type { Abi, AbiFunction, Address } from "viem";
import { usePublicClient } from "wagmi";
import { useDeployedContractInfo, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";

type Exit = "withdraw" | "redeem";

/**
 * Pool writes. Each one is simulated first against the live pool, so a call that would revert is stopped before
 * the wallet opens and its custom error reaches the page (mapped to words by poolErrors.ts). Then it goes through
 * the template's transactor, which shows the pending and done toasts with a HashScan link.
 *
 * Works with both pool shapes, picked from the ABI in deployedContracts.ts:
 * - ERC-4626 pool (deployed today): withdraw(assets, receiver, owner), redeem(shares, receiver, owner)
 * - HTS-share pool (contracts b059795): withdraw(assets, receiver), redeem(shares, receiver); the caller is the owner
 * deposit(assets, receiver) is the same in both.
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

  const inputs = (name: string) =>
    (pool?.abi as Abi | undefined)
      ?.filter((item): item is AbiFunction => item.type === "function")
      .find(item => item.name === name)?.inputs.length;

  const send = async (functionName: "deposit" | Exit, args: readonly unknown[]) => {
    if (!publicClient || !pool || !account) throw new Error("Wallet or pool not ready");
    await publicClient.simulateContract({ address: pool.address, abi: pool.abi as Abi, account, functionName, args });
    // The args are built to match whichever ABI is deployed, which the generated types can't express.
    return writeContractAsync({ functionName, args } as Parameters<typeof writeContractAsync>[0]);
  };

  // A third `owner` argument only on the ERC-4626 pool.
  const exitArgs = (fn: Exit, amount: bigint) => (inputs(fn) === 3 ? [amount, account!, account!] : [amount, account!]);

  return {
    /** deposit(assets, me): USDC in, shares out. Needs USDC approved to the pool. */
    deposit: (assets: bigint) => send("deposit", [assets, account!]),
    /** withdraw(assets, me[, me]): exact USDC out, the shares it takes are burned. */
    withdraw: (assets: bigint) => send("withdraw", exitArgs("withdraw", assets)),
    /** redeem(shares, me[, me]): exact shares burned, USDC out at the share price. */
    redeem: (shares: bigint) => send("redeem", exitArgs("redeem", shares)),
    isMining,
  };
};
