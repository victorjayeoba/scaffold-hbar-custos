"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type DocsPage, docsNav, docsPages } from "./nav";
import { Bars3Icon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";

function matches(page: DocsPage, query: string): boolean {
  const haystack = [page.title, page.description, ...(page.keywords ?? [])].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => haystack.includes(word));
}

/**
 * Search over the docs: arrow keys move through results, Enter opens one, Escape clears the text.
 * `shortcut` makes "/" focus this box (only the always-visible copy takes it).
 */
function DocsSearch({ onNavigate, shortcut = false }: { onNavigate: () => void; shortcut?: boolean }) {
  const router = useRouter();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => (query.trim() ? docsPages.filter(p => matches(p, query)) : []), [query]);
  const optionId = (i: number) => `${uid}-result-${i}`;

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const input = inputRef.current;
      if (typing || !input || input.offsetParent === null) return; // hidden on small screens: leave the key alone
      e.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId only depends on uid, which never changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const go = (page: DocsPage) => {
    setQuery("");
    router.push(page.href);
    onNavigate();
  };

  const searching = query.trim().length > 0;

  return (
    <div className="relative">
      <label htmlFor={`${uid}-input`} className="sr-only">
        Search the docs
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 focus-within:border-primary">
        <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-base-content/50" aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${uid}-input`}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={`${uid}-results`}
          aria-activedescendant={results[active] ? optionId(active) : undefined}
          autoComplete="off"
          placeholder="Search docs"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={e => {
            if (e.key === "ArrowDown" && results.length > 0) {
              e.preventDefault();
              setActive(i => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp" && results.length > 0) {
              e.preventDefault();
              setActive(i => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              go(results[active]);
            } else if (e.key === "Escape" && query) {
              e.preventDefault(); // clear the text first; a second Escape closes the menu
              setQuery("");
            }
          }}
          className="w-full min-w-0 bg-transparent text-sm outline-none"
        />
        {shortcut && (
          <kbd className="hidden rounded border border-base-300 px-1.5 text-xs text-base-content/50 lg:inline">/</kbd>
        )}
      </div>
      {results.length > 0 && (
        <ul
          id={`${uid}-results`}
          role="listbox"
          aria-label="Matching pages"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-1 shadow-lg"
        >
          {results.map((page, i) => (
            <li
              key={page.href}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseDown={e => {
                e.preventDefault();
                go(page);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer rounded-md px-3 py-2 ${i === active ? "bg-base-200" : ""}`}
            >
              <p className="text-sm font-medium">{page.title}</p>
              <p className="text-xs text-base-content/60">{page.description}</p>
            </li>
          ))}
        </ul>
      )}
      {searching && results.length === 0 && (
        <p
          role="status"
          className="absolute z-20 mt-1 w-full rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content/60 shadow-lg"
        >
          No pages match.
        </p>
      )}
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="mt-6 space-y-6">
      {docsNav.map(section => (
        <div key={section.title}>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-base-content/50">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.pages.map(page => {
              const current = pathname === page.href;
              return (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={`block rounded-md px-3 py-1.5 text-sm transition focus-visible:outline-2 focus-visible:outline-primary ${
                      current
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-base-content/75 hover:bg-base-200 hover:text-base-content"
                    }`}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Sticky sidebar on large screens; on small ones a "Menu" button opens the same nav in a native <dialog>, which
 * traps focus, makes the page behind inert, closes on Escape and returns focus to the button.
 */
export function DocsSidebar() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

  return (
    <>
      <div className="-mx-4 flex items-center gap-2 border-b border-base-300 px-4 pb-2 lg:hidden">
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Bars3Icon className="h-5 w-5" aria-hidden="true" />
          Menu
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-label="Documentation menu"
        onClick={e => e.target === dialogRef.current && close()}
        className="m-0 h-full max-h-none w-72 max-w-[85vw] bg-base-100 p-4 text-base-content shadow-xl backdrop:bg-black/40 lg:hidden"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-semibold">Custos docs</span>
          <button type="button" onClick={close} aria-label="Close menu" className="rounded p-1 hover:bg-base-200">
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <DocsSearch onNavigate={close} />
        <NavLinks onNavigate={close} />
      </dialog>

      <aside className="hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-8 pr-2">
          <DocsSearch onNavigate={close} shortcut />
          <NavLinks onNavigate={close} />
        </div>
      </aside>
    </>
  );
}
