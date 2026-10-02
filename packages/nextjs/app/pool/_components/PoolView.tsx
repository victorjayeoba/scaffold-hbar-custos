"use client";

import { PoolActions } from "./PoolActions";
import { PoolContracts } from "./PoolContracts";
import { PoolEarningsCard } from "./PoolEarningsCard";
import { PoolOverview } from "./PoolOverview";
import { PoolPosition } from "./PoolPosition";
import { useAccount } from "wagmi";
import { usePool } from "~~/hooks/custos/usePool";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";

/** The Pool page: what the pool holds, what you hold in it, and the two things you can do (deposit, withdraw). */
export const PoolView = () => {
  const { address, chain, isConnected } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const pool = usePool(isConnected ? address : undefined);
  const wrongNetwork = isConnected && chain?.id !== targetNetwork.id;

  return (
    <div className="flex grow flex-col">
      <section className="mx-auto w-full max-w-6xl px-5 pt-12 sm:pt-16">
        <h1 className="m-0 text-[clamp(2.25rem,5vw,3.5rem)] font-normal leading-[1.05] tracking-[-0.02em]">
          Be the house
        </h1>
        <p className="mt-4 mb-0 max-w-3xl text-lg leading-relaxed text-base-content/80">
          The pool is the other side of every trade. LPs earn trading fees, liquidated collateral and what traders lose;
          they pay what traders win and the network&apos;s keeper fees. Withdrawals stop at the USDC open positions
          need.
        </p>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pt-10" aria-labelledby="pool-overview-heading">
        <h2 id="pool-overview-heading" className="sr-only">
          Pool overview
        </h2>
        <PoolOverview pool={pool} />
      </section>

      <section className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-5 pt-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <PoolActions pool={pool} owner={isConnected ? address : undefined} wrongNetwork={wrongNetwork} />
        <PoolPosition pool={pool} connected={isConnected} wrongNetwork={wrongNetwork} />
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pt-16" aria-labelledby="pool-earnings-heading">
        <PoolEarningsCard usdcHeld={pool.usdcHeld} />
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <PoolContracts pool={pool} />
      </section>
    </div>
  );
};
