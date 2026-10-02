"use client";

import { useState } from "react";
import { CheckCircleIcon } from "@heroicons/react/24/solid";

export type Step = {
  key: string;
  /** What the step is, shown in the list. */
  label: string;
  done: boolean;
  /** Text on the button when this is the next step. */
  action: string;
  run: () => Promise<unknown>;
};

/**
 * A short, ordered checklist (associate → approve → deposit) driven by one button that always does the next step.
 * Hedera needs a token association before an account can hold a token, and the pool needs an approval before it can
 * pull it, so the order matters and is shown as numbers.
 */
export const PoolSteps = ({
  steps,
  disabled,
  onError,
  onDone,
}: {
  steps: Step[];
  /** The amount isn't usable yet, or something blocks every step. */
  disabled: boolean;
  onError: (error: unknown) => void;
  /** Called after the final step succeeds. */
  onDone: () => void;
}) => {
  const [busy, setBusy] = useState<string>();
  const next = steps.find(s => !s.done);
  const showList = steps.length > 1;

  const go = async () => {
    if (!next) return;
    setBusy(next.key);
    onError(undefined);
    try {
      const result = await next.run();
      // writeContractAsync resolves undefined when it refused to send (no wallet / wrong network) and toasted why.
      if (next.key === steps[steps.length - 1].key && result !== undefined) onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="mt-6">
      {showList && (
        <ol className="m-0 mb-4 list-none space-y-2 p-0 text-sm" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              {s.done ? (
                <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" aria-hidden />
              ) : (
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums ${
                    s === next ? "border-primary text-primary" : "border-base-content/30 text-base-content/50"
                  }`}
                  aria-hidden
                >
                  {i + 1}
                </span>
              )}
              <span className={s.done ? "text-base-content/60 line-through decoration-base-content/30" : ""}>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : s === next ? " (next)" : ""}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <button
        type="submit"
        className="btn btn-primary w-full rounded-full"
        disabled={disabled || !next || busy !== undefined}
        onClick={e => {
          e.preventDefault();
          go();
        }}
      >
        {busy !== undefined && <span className="loading loading-spinner loading-sm" aria-hidden />}
        {busy !== undefined ? "Confirm in your wallet…" : (next?.action ?? "Done")}
      </button>
    </div>
  );
};
