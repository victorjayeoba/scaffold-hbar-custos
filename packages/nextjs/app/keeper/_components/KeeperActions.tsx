"use client";

import { useState } from "react";
import { hbar, utcDay, utcTime } from "./format";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseEther } from "viem";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useKeeperHealth } from "~~/hooks/custos/useKeeperHealth";
import { useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";

// Gas for each call, as the deploy script sends them (packages/foundry/scripts-js/custos.js).
// revive() books the next run on the Schedule Service, which alone costs ~1.41M gas.
const FUND_GAS = 100_000n;
const REVIVE_GAS = 2_000_000n;
const PRESET_RUNS = [12, 48];
// HBAR has 8 decimals; anything finer can't be sent.
const HBAR_AMOUNT = /^\d+(\.\d{1,8})?$/;

/** Top up the reserve with fund(), or restart a broken chain with revive(). Both need a connected wallet. */
export const KeeperActions = () => {
  const k = useKeeperHealth();
  const { isConnected, chainId } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "PerpMarket" });
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<"fund" | "revive">();

  const wrongNetwork = isConnected && chainId !== targetNetwork.id;
  const ready = isConnected && !wrongNetwork && !pending;
  const validAmount = HBAR_AMOUNT.test(amount) && Number(amount) > 0;
  const broken = k.state === "overdue" || k.state === "stopped";

  const send = async (action: "fund" | "revive") => {
    setPending(action);
    try {
      if (action === "fund") {
        await writeContractAsync({ functionName: "fund", value: parseEther(amount), gas: FUND_GAS });
        setAmount("");
      } else {
        await writeContractAsync({ functionName: "revive", gas: REVIVE_GAS });
      }
      await queryClient.invalidateQueries();
    } catch {
      // useScaffoldWriteContract already showed the error.
    } finally {
      setPending(undefined);
    }
  };

  const reviveBlocker = !k.canRevive
    ? k.state === "loading"
      ? "Reading the keeper…"
      : k.state === "late" && k.reviveOpensAt
        ? `Opens at ${utcTime(k.reviveOpensAt)} UTC on ${utcDay(k.reviveOpensAt)}, two intervals after the missed check.`
        : "Not needed: the next check is booked."
    : undefined;

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
      <h3 className="m-0 text-xl font-normal">Keep it running</h3>
      <p className="mt-2 mb-0 text-sm text-base-content/70">
        Anyone can do both. Neither gives you control of the market: the network still runs every check.
      </p>

      {!isConnected && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-box bg-base-200 p-4">
          <span className="text-sm">Connect a wallet to top up or revive.</span>
          <RainbowKitCustomConnectButton />
        </div>
      )}
      {wrongNetwork && (
        <p role="alert" className="mt-5 mb-0 rounded-box bg-warning/20 p-4 text-sm">
          Switch your wallet to {targetNetwork.name} to send these.
        </p>
      )}

      <form
        className="mt-6"
        onSubmit={e => {
          e.preventDefault();
          if (validAmount && ready) send("fund");
        }}
      >
        <h4 className="m-0 text-base font-medium">{broken ? "1. " : ""}Top up the reserve</h4>
        <p className="mt-1 mb-3 text-sm text-base-content/70">
          Sends HBAR to <code>fund()</code>. It only pays for scheduled runs.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {PRESET_RUNS.map(runs => {
            const need = k.topUpFor(runs);
            if (need === undefined) return null;
            // Round up to a tenth of an HBAR so the preset always covers the runs.
            const value = (Math.ceil(Number(formatUnits(need, 8)) * 10) / 10).toFixed(1);
            return (
              <button
                key={runs}
                type="button"
                className="btn btn-sm btn-ghost rounded-full border border-base-300"
                disabled={need === 0n}
                onClick={() => setAmount(value)}
              >
                {need === 0n ? `${runs} runs covered` : `${runs} runs · ${value} HBAR`}
              </button>
            );
          })}
        </div>
        <label htmlFor="fund-amount" className="text-sm text-base-content/70">
          Amount in HBAR
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="fund-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="20"
            className="input input-bordered min-w-0 flex-1 tabular-nums"
            value={amount}
            onChange={e => setAmount(e.target.value.trim())}
            aria-invalid={amount !== "" && !validAmount}
            aria-describedby="fund-hint"
          />
          <button type="submit" className="btn btn-primary rounded-full" disabled={!ready || !validAmount}>
            {pending === "fund" ? <span className="loading loading-spinner loading-sm" aria-label="Sending" /> : "Fund"}
          </button>
        </div>
        <p id="fund-hint" className="mt-1 mb-0 min-h-5 text-xs text-base-content/60">
          {amount !== "" && !validAmount
            ? "Enter a positive amount with at most 8 decimals."
            : k.holdPerRun !== undefined
              ? `Each run needs ${hbar(k.holdPerRun)} HBAR available before it starts.`
              : ""}
        </p>
      </form>

      <div className="mt-6 border-t border-base-300 pt-6">
        <h4 className="m-0 text-base font-medium">{broken ? "2. " : ""}Revive the chain</h4>
        <p className="mt-1 mb-3 text-sm text-base-content/70">
          If a booked check doesn&apos;t run, nothing books the one after it. <code>revive()</code> books a new check
          one interval from now. It opens once the chain is two intervals late.
        </p>
        {k.canRevive && k.canPayNextRun === false && (
          <p role="status" className="mt-0 mb-3 rounded-box bg-warning/20 p-3 text-sm">
            Top up first. With the reserve this low, the revived check would fail the same way.
          </p>
        )}
        <button
          type="button"
          className="btn btn-secondary rounded-full"
          disabled={!ready || !k.canRevive}
          aria-describedby="revive-hint"
          onClick={() => send("revive")}
        >
          {pending === "revive" ? (
            <span className="loading loading-spinner loading-sm" aria-label="Sending" />
          ) : (
            "Revive the keeper"
          )}
        </button>
        <p id="revive-hint" className="mt-2 mb-0 text-xs text-base-content/60">
          {reviveBlocker ?? "The chain is broken, so revive() is open to anyone."}
        </p>
      </div>
    </div>
  );
};
