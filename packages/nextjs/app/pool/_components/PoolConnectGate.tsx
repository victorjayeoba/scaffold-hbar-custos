"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";

/** What to show instead of a form when there's no wallet, or it's on another network. */
export const PoolConnectGate = ({ wrongNetwork, what }: { wrongNetwork: boolean; what: string }) => {
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending } = useSwitchChain();
  const { targetNetwork } = useTargetNetwork();

  if (wrongNetwork) {
    return (
      <div className="rounded-box bg-base-200 p-5">
        <p className="m-0">Your wallet is on another network. The pool lives on {targetNetwork.name}.</p>
        <button
          type="button"
          className="btn btn-primary mt-4 rounded-full"
          onClick={() => switchChain?.({ chainId: targetNetwork.id })}
          disabled={isPending}
        >
          {isPending ? "Switching…" : `Switch to ${targetNetwork.name}`}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-box bg-base-200 p-5">
      <p className="m-0">Connect a wallet {what}.</p>
      <button type="button" className="btn btn-primary mt-4 rounded-full" onClick={openConnectModal}>
        Connect wallet
      </button>
    </div>
  );
};
