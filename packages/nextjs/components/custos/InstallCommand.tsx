"use client";

import { CheckIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { useCopyToClipboard } from "~~/hooks/scaffold-hbar";

export const INSTALL_COMMAND = "npm create scaffold-hbar@latest --template victorjayeoba/scaffold-hbar-custos";

/** The one command that starts a project from this template, with a copy button. */
export const InstallCommand = ({ onDark = false }: { onDark?: boolean }) => {
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();

  return (
    <div
      className={`flex items-center gap-3 rounded-box px-4 py-3 font-mono text-sm ${
        onDark ? "bg-white/10 text-white" : "bg-base-200 text-base-content"
      }`}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap bg-transparent p-0">{INSTALL_COMMAND}</code>
      <button
        type="button"
        onClick={() => copyToClipboard(INSTALL_COMMAND)}
        className="btn btn-ghost btn-sm btn-square shrink-0"
        aria-label={isCopiedToClipboard ? "Copied" : "Copy the command"}
      >
        {isCopiedToClipboard ? <CheckIcon className="h-4 w-4" /> : <DocumentDuplicateIcon className="h-4 w-4" />}
      </button>
    </div>
  );
};
