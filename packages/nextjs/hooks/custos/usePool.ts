import type { Address } from "viem";
import { POLL } from "~~/hooks/custos/poll";
import { useHtsToken } from "~~/hooks/custos/useHtsToken";
import { usePoolShares } from "~~/hooks/custos/usePoolShares";
import { usePriceFeeds } from "~~/hooks/custos/usePriceFeeds";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-hbar";

/**
 * Everything the Pool page reads, in one place.
 *
 * - The pool (ERC-4626-style, HTS shares): total assets, free assets, share price, and the connected LP's limits.
 * - The market: open interest the pool backs and the liquidity it requires (PerpMarket keeps 2× open notional).
 * - The two tokens: USDC (the pool's `asset()`, an HTS token) and the LP share token (see usePoolShares).
 */
export const usePool = (owner?: Address) => {
  const { data: poolInfo } = useDeployedContractInfo({ contractName: "LiquidityPool" });

  const totalAssets = useScaffoldReadContract({ contractName: "LiquidityPool", functionName: "totalAssets", ...POLL });
  const freeAssets = useScaffoldReadContract({ contractName: "LiquidityPool", functionName: "freeAssets", ...POLL });
  // Address reads come back as `string` (types/abitype/abi.d.ts); whether viem's `Address` is `string` too depends
  // on which abitype copy the package manager installs for viem, so type the read here and it compiles under both.
  const asset = useScaffoldReadContract({ contractName: "LiquidityPool", functionName: "asset", ...POLL }).data as
    | Address
    | undefined;

  // Read from the market rather than the pool: the pool only forwards it, and the market's view is stable.
  const { data: requiredLiquidity } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "requiredLiquidity",
    ...POLL,
  });
  const { data: longNotional } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "longNotional",
    ...POLL,
  });
  const { data: shortNotional } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "shortNotional",
    ...POLL,
  });
  const { data: maxOpenInterestBps } = useScaffoldReadContract({
    contractName: "PerpMarket",
    functionName: "MAX_OPEN_INTEREST_BPS",
    ...POLL,
  });

  const shares = usePoolShares(owner);
  const usdc = useHtsToken({ token: asset, owner, spender: poolInfo?.address });
  // USDC the pool holds. totalAssets also nets traders' open gains, so the cash balance is read separately.
  const { balance: usdcHeld } = useHtsToken({
    token: asset,
    owner: poolInfo?.address,
    spender: poolInfo?.address,
    checkAssociation: false,
  });

  // One whole share, in share units (the HTS share token has 6 decimals, like USDC).
  const oneShare = shares.decimals !== undefined ? 10n ** BigInt(shares.decimals) : undefined;
  const { data: sharePrice } = useScaffoldReadContract({
    contractName: "LiquidityPool",
    functionName: "convertToAssets",
    args: [oneShare],
    ...POLL,
  });

  const { data: myValue } = useScaffoldReadContract({
    contractName: "LiquidityPool",
    functionName: "convertToAssets",
    args: [shares.balance],
    ...POLL,
  });
  const { data: maxWithdraw, refetch: refetchMaxWithdraw } = useScaffoldReadContract({
    contractName: "LiquidityPool",
    functionName: "maxWithdraw",
    args: [owner],
    ...POLL,
  });
  const { data: maxRedeem, refetch: refetchMaxRedeem } = useScaffoldReadContract({
    contractName: "LiquidityPool",
    functionName: "maxRedeem",
    args: [owner],
    ...POLL,
  });

  const openInterest =
    longNotional !== undefined && shortNotional !== undefined ? longNotional + shortNotional : undefined;

  // The pool refuses deposits and withdrawals without an Ok price while positions are open (LiquidityPool__NoPrice).
  const { status: priceStatus } = usePriceFeeds();
  const paused =
    (priceStatus === "stale" || priceStatus === "deviated") && openInterest !== undefined && openInterest > 0n;

  const refetch = async () => {
    await Promise.all([
      totalAssets.refetch(),
      freeAssets.refetch(),
      refetchMaxWithdraw(),
      refetchMaxRedeem(),
      shares.refetch(),
      usdc.refetch(),
    ]);
  };

  return {
    poolAddress: poolInfo?.address,
    totalAssets: totalAssets.data,
    freeAssets: freeAssets.data,
    usdcHeld,
    paused,
    requiredLiquidity,
    openInterest,
    longNotional,
    shortNotional,
    maxOpenInterestBps,
    sharePrice,
    loaded: totalAssets.data !== undefined && freeAssets.data !== undefined,
    error: totalAssets.error ?? freeAssets.error,
    usdc,
    shares,
    me: {
      value: myValue,
      maxWithdraw,
      maxRedeem,
    },
    refetch,
  };
};

export type PoolState = ReturnType<typeof usePool>;
