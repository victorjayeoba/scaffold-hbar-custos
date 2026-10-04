"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Heading = { id: string; text: string; level: number };

/** "On this page": the page's h2/h3 headings, with the one in view highlighted. */
export function DocsToc() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("article [data-toc]"));
    setHeadings(
      nodes.map(n => ({
        id: n.id,
        text: n.dataset.tocText ?? (n.textContent ?? "").trim(),
        level: Number(n.dataset.toc),
      })),
    );
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    nodes.forEach(n => observer.observe(n));
    return () => observer.disconnect();
  }, [pathname]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="On this page" className="sticky top-6 text-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-base-content/50">On this page</p>
      <ul className="space-y-1.5 border-l border-base-300">
        {headings.map((h, i) => (
          <li key={`${h.id}-${i}`} className={h.level === 3 ? "pl-6" : "pl-3"}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l-2 pl-3 transition ${
                active === h.id
                  ? "border-primary text-primary"
                  : "border-transparent text-base-content/60 hover:text-base-content"
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
