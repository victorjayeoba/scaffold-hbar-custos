import { CheckIcon } from "@heroicons/react/20/solid";

export type Step = { label: string; state: "todo" | "done" | "loading"; note?: string };

/** The wallet steps a trade needs (associate, approve, open), numbered because the order matters. */
export const Steps = ({ steps }: { steps: Step[] }) => {
  const current = steps.findIndex(s => s.state !== "done");
  return (
    <ol className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-start gap-2" aria-current={i === current ? "step" : undefined}>
          <span
            className={`mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
              s.state === "done"
                ? "bg-success text-black"
                : i === current
                  ? "bg-primary text-primary-content"
                  : "border border-base-300 text-base-content/60"
            }`}
          >
            {s.state === "done" ? (
              <CheckIcon className="h-3.5 w-3.5" aria-label="done" />
            ) : s.state === "loading" ? (
              <span className="loading loading-spinner h-3 w-3" aria-label="checking" />
            ) : (
              i + 1
            )}
          </span>
          <span>
            <span className={i === current ? "" : "text-base-content/70"}>{s.label}</span>
            {s.note && <span className="block text-xs text-base-content/55">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
};
