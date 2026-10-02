import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Address, erc20Abi } from "viem";
import { useReadContracts, useWriteContract } from "wagmi";
import { POLL } from "~~/hooks/custos/poll";
import { useTargetNetwork, useTransactor } from "~~/hooks/scaffold-hbar";
import { chainIdToHederaNetwork, getHederaAccountId } from "~~/utils/scaffold-hbar";

/**
 * One token, from one account's point of view: balance, allowance to a spender, and whether the account is
 * associated with it on Hedera. Works for HTS tokens (through their ERC-20 facade) and for plain ERC-20s, so a page
 * can treat both the same way. Reusable by any page that takes a token from the user (pool deposits, trade collateral).
 *
 * HTS tokens have a "long-zero" EVM address (0x000…<token num>). Before an account can hold one it must be
 * associated with it (HIP-719: call associate() on the token address), unless it has unlimited auto-associations.
 */

/** HIP-719: an HTS token's facade lets the calling account associate itself. */
const hrc719Abi = [
  {
    type: "function",
    name: "associate",
    inputs: [],
    outputs: [{ name: "responseCode", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

export type Association =
  /** Waiting for the mirror node. */
  | "loading"
  /** The account holds an association with the token. */
  | "associated"
  /** Not associated, but the account has unlimited auto-associations, so the first transfer associates it. */
  | "auto"
  /** The account must associate before it can receive the token. */
  | "not-associated"
  /** The EVM address has no Hedera account yet (it gets one when it first receives HBAR). */
  | "no-account"
  /** A plain ERC-20: nothing to associate. */
  | "not-required"
  /** The mirror node didn't answer. */
  | "unknown";

const MIRROR_NODES: Record<number, string> = {
  296: "https://testnet.mirrornode.hedera.com",
  295: "https://mainnet.mirrornode.hedera.com",
};

export const mirrorNodeUrl = (chainId: number) => MIRROR_NODES[chainId] ?? MIRROR_NODES[296];

/** 0.0.429274 for 0x0000000000000000000000000000000000068cda; undefined if the address isn't long-zero. */
export const htsTokenId = (address?: string) => {
  if (!address || !/^0x0{24}[0-9a-f]{16}$/i.test(address)) return undefined;
  const num = BigInt(address);
  return num > 0n ? `0.0.${num}` : undefined;
};

const fetchAssociation = async (chainId: number, owner: Address, tokenId: string): Promise<Association> => {
  // Resolve the account through the app's own route first: it answers 200 with null for an address that has no
  // Hedera account yet, where the mirror node would answer 404 (a console error in the browser).
  const accountId = await getHederaAccountId(owner, chainIdToHederaNetwork(chainId));
  if (!accountId) return "no-account";
  const mirror = mirrorNodeUrl(chainId);
  const res = await fetch(`${mirror}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`);
  if (!res.ok) throw new Error(`Mirror node answered ${res.status}`);
  const { tokens } = (await res.json()) as { tokens?: { token_id: string }[] };
  if (tokens?.some(t => t.token_id === tokenId)) return "associated";

  const account = await fetch(`${mirror}/api/v1/accounts/${accountId}?transactions=false`);
  if (!account.ok) return "not-associated";
  const { max_automatic_token_associations: auto } = (await account.json()) as {
    max_automatic_token_associations?: number;
  };
  return auto === -1 ? "auto" : "not-associated";
};

export const useHtsToken = ({
  token,
  owner,
  spender,
  checkAssociation = true,
}: {
  token?: Address;
  owner?: Address;
  spender?: Address;
  /** Skip the mirror-node association lookup (e.g. when only reading a contract's balance). */
  checkAssociation?: boolean;
}) => {
  const { targetNetwork } = useTargetNetwork();
  const chainId = targetNetwork.id;
  const tokenId = htsTokenId(token);
  const isHts = tokenId !== undefined;

  const meta = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: token, abi: erc20Abi, functionName: "symbol", chainId },
      { address: token, abi: erc20Abi, functionName: "decimals", chainId },
      { address: token, abi: erc20Abi, functionName: "totalSupply", chainId },
    ],
    query: { enabled: !!token, ...POLL.query },
  });
  const mine = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner!], chainId },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [owner!, spender!], chainId },
    ],
    query: { enabled: !!token && !!owner && !!spender, ...POLL.query },
  });
  const [symbol, decimals, totalSupply] = meta.data ?? [];
  const [balance, allowance] = mine.data ?? [];
  const ok = <T>(r?: { status: string; result?: unknown }) => (r?.status === "success" ? (r.result as T) : undefined);

  const association = useQuery({
    queryKey: ["custos", "hts-association", chainId, owner, tokenId],
    queryFn: () => fetchAssociation(chainId, owner!, tokenId!),
    enabled: !!owner && isHts && checkAssociation,
    ...POLL.query,
  });
  // The mirror node trails consensus by a few seconds; remember an association we just made.
  const [justAssociated, setJustAssociated] = useState<string>();

  let status: Association;
  if (!isHts) status = token ? "not-required" : "loading";
  else if (!checkAssociation) status = "unknown";
  else if (!owner) status = "loading";
  else if (justAssociated === `${owner}:${tokenId}`) status = "associated";
  else if (association.isError) status = "unknown";
  else status = association.data ?? "loading";

  const writeTx = useTransactor();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState<"associate" | "approve">();

  const refetch = useCallback(async () => {
    await Promise.all([meta.refetch(), mine.refetch(), association.refetch()]);
  }, [meta, mine, association]);

  /** Associates the connected account with the token (HIP-719). Throws on failure; the transactor shows a toast. */
  const associate = useCallback(async () => {
    if (!token || !owner) return;
    setPending("associate");
    try {
      const hash = await writeTx(() =>
        writeContractAsync({ address: token, abi: hrc719Abi, functionName: "associate", chainId }),
      );
      if (hash) setJustAssociated(`${owner}:${tokenId}`);
      await refetch();
      return hash;
    } finally {
      setPending(undefined);
    }
  }, [token, owner, tokenId, chainId, writeTx, writeContractAsync, refetch]);

  /** Approves `spender` for exactly `amount` (no unlimited approvals). */
  const approve = useCallback(
    async (amount: bigint) => {
      if (!token || !spender) return;
      setPending("approve");
      try {
        const hash = await writeTx(() =>
          writeContractAsync({
            address: token,
            abi: erc20Abi,
            functionName: "approve",
            args: [spender, amount],
            chainId,
          }),
        );
        await refetch();
        return hash;
      } finally {
        setPending(undefined);
      }
    },
    [token, spender, chainId, writeTx, writeContractAsync, refetch],
  );

  return {
    address: token,
    tokenId,
    isHts,
    symbol: ok<string>(symbol),
    decimals: ok<number>(decimals),
    totalSupply: ok<bigint>(totalSupply),
    // The token facade reverts for an address with no Hedera account; it holds nothing and has approved nothing.
    balance: owner ? (status === "no-account" ? 0n : ok<bigint>(balance)) : undefined,
    allowance: owner && spender ? (status === "no-account" ? 0n : ok<bigint>(allowance)) : undefined,
    association: status,
    /** True when the account can receive the token now (associated, auto-associates, or not an HTS token). */
    canReceive: status === "associated" || status === "auto" || status === "not-required",
    isLoading: meta.isLoading || (!!owner && mine.isLoading),
    isError: meta.isError || mine.isError,
    isAssociating: pending === "associate",
    isApproving: pending === "approve",
    associate,
    approve,
    refetch,
  };
};

export type HtsToken = ReturnType<typeof useHtsToken>;
