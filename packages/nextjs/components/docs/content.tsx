import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { CopyButton } from "./CopyButton";
import {
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  LightBulbIcon,
} from "@heroicons/react/24/outline";

/** Turns a heading into the id its anchor and the "On this page" outline use. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function H2({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? slug(children);
  return (
    <h2
      id={anchor}
      data-toc="2"
      data-toc-text={children}
      className="group mt-12 mb-4 scroll-mt-24 text-2xl font-semibold tracking-tight"
    >
      {children}
      <a
        href={`#${anchor}`}
        aria-label={`Link to ${children}`}
        className="ml-2 opacity-0 group-hover:opacity-50 focus-visible:opacity-100"
      >
        #
      </a>
    </h2>
  );
}

export function H3({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? slug(children);
  return (
    <h3 id={anchor} data-toc="3" data-toc-text={children} className="mt-8 mb-3 scroll-mt-24 text-lg font-semibold">
      {children}
    </h3>
  );
}

/** Body text with consistent spacing for paragraphs, lists, inline code and links. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div
      className={[
        "leading-7 text-base-content/90",
        "[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
        "[&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline",
        "[&_strong]:font-semibold [&_strong]:text-base-content",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[0.85em] break-words">{children}</code>;
}

/** A code block with a language label and a copy button. */
export function CodeBlock({ code, lang = "bash", title }: { code: string; lang?: string; title?: string }) {
  const text = code.replace(/^\n+|\n+$/g, "");
  return (
    <div className="my-5 overflow-hidden rounded-xl border border-base-300 bg-base-200">
      <div className="flex items-center justify-between border-b border-base-300 px-4 py-1.5 text-xs text-base-content/60">
        <span className="font-mono">{title ?? lang}</span>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-6">
        <code className="font-mono">{text}</code>
      </pre>
    </div>
  );
}

const CALLOUT = {
  info: { icon: InformationCircleIcon, cls: "border-info/40 bg-info/10", label: "Note" },
  tip: { icon: LightBulbIcon, cls: "border-success/50 bg-success/10", label: "Tip" },
  warning: { icon: ExclamationTriangleIcon, cls: "border-warning/60 bg-warning/15", label: "Heads up" },
};

export function Callout({
  type = "info",
  title,
  children,
}: {
  type?: keyof typeof CALLOUT;
  title?: string;
  children: ReactNode;
}) {
  const { icon: Icon, cls, label } = CALLOUT[type];
  return (
    <aside className={`my-6 flex gap-3 rounded-xl border p-4 ${cls}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-sm leading-6 [&_p]:my-1">
        <p className="font-semibold">{title ?? label}</p>
        {children}
      </div>
    </aside>
  );
}

/** A numbered sequence of steps, each with a heading. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="relative my-6 ml-3 border-l border-base-300 [counter-reset:step]">{children}</ol>;
}

export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="relative mb-8 pl-8 [counter-increment:step] last:mb-0">
      <span
        aria-hidden="true"
        className="absolute -left-3.5 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-content before:content-[counter(step)]"
      />
      <h3 id={slug(title)} data-toc="3" data-toc-text={title} className="scroll-mt-24 font-semibold leading-7">
        {title}
      </h3>
      <div className="leading-7 text-base-content/90 [&_p]:my-2">{children}</div>
    </li>
  );
}

/** A screenshot from /public/docs with a caption. */
export function Figure({
  src,
  alt,
  caption,
  width,
  height,
}: {
  src: string;
  alt: string;
  caption?: string;
  width: number;
  height: number;
}) {
  return (
    <figure className="my-6">
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes="(min-width: 1024px) 768px, 100vw"
        className="h-auto w-full rounded-xl border border-base-300"
      />
      {caption && <figcaption className="mt-2 text-center text-sm text-base-content/60">{caption}</figcaption>}
    </figure>
  );
}

/** A responsive table: scrolls sideways inside its box on narrow screens instead of widening the page. */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="relative my-6 overflow-x-auto rounded-xl border border-base-300">
      <table className="w-full text-left text-sm">
        <thead className="bg-base-200">
          <tr>
            {head.map(h => (
              <th key={h} scope="col" className="px-4 py-2 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-base-300 align-top">
              {row.map((cell, c) => (
                <td key={c} className="px-4 py-2 [&_code]:whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A grid of cards linking to other pages. */
export function Cards({ children }: { children: ReactNode }) {
  return <div className="my-6 grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Card({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-base-300 p-4 transition hover:border-primary hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-base-content/70">{children}</p>
    </Link>
  );
}

/** A link that leaves the docs (HashScan, GitHub): opens in a new tab and says so. */
export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-words">
      {children}
      <ArrowTopRightOnSquareIcon className="ml-0.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
      {/* visually hidden without position:absolute, so it can't escape a scrolling table and widen the page */}
      <span className="inline-block h-px w-px overflow-hidden whitespace-nowrap [clip-path:inset(50%)]">
        (opens in a new tab)
      </span>
    </a>
  );
}

/** A HashScan link for a transaction hash, contract address or entity id, shortened for display. */
export function HashScan({
  kind,
  id,
  label,
}: {
  kind: "transaction" | "contract" | "topic" | "token" | "schedule" | "account";
  id: string;
  label?: string;
}) {
  const short = id.startsWith("0x") && id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
  return (
    <Ext href={`https://hashscan.io/testnet/${kind}/${id}`}>
      <span className="font-mono text-[0.85em]">{label ?? short}</span>
    </Ext>
  );
}
