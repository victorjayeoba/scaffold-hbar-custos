import type { ReactNode } from "react";
import { DocsSidebar } from "~~/components/docs/DocsSidebar";
import { DocsToc } from "~~/components/docs/DocsToc";

/** The docs' three columns: navigation, the page, and its outline. Collapses to one column on small screens. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
        <DocsSidebar />
        <div id="docs-content" className="min-w-0 max-w-3xl">
          {children}
        </div>
        <div className="hidden xl:block">
          <DocsToc />
        </div>
      </div>
    </div>
  );
}
