import type { ReactNode } from "react";
import Link from "next/link";
import { neighbours } from "./nav";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";

/** One docs page: section label, title, lead paragraph, content, then previous/next links. */
export function Doc({
  href,
  section,
  title,
  lead,
  children,
}: {
  href: string;
  section: string;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  const { prev, next } = neighbours(href);
  return (
    <article className="min-w-0">
      <p className="text-sm font-medium text-primary">{section}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-4 text-lg leading-8 break-words text-base-content/75">{lead}</p>
      <div className="mt-8">{children}</div>

      <nav
        aria-label="Previous and next page"
        className="mt-16 grid gap-4 border-t border-base-300 pt-6 sm:grid-cols-2"
      >
        {prev ? (
          <Link href={prev.href} className="group rounded-xl border border-base-300 p-4 hover:border-primary">
            <span className="flex items-center gap-1 text-xs text-base-content/60">
              <ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden="true" /> Previous
            </span>
            <span className="mt-1 block font-medium group-hover:text-primary">{prev.title}</span>
          </Link>
        ) : null}
        {next && (
          <Link
            href={next.href}
            className="group rounded-xl border border-base-300 p-4 text-right hover:border-primary sm:col-start-2"
          >
            <span className="flex items-center justify-end gap-1 text-xs text-base-content/60">
              Next <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="mt-1 block font-medium group-hover:text-primary">{next.title}</span>
          </Link>
        )}
      </nav>
    </article>
  );
}
