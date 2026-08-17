/** @jsxImportSource react */
/**
 * Chrome for the slim share page: a single header, a titled content column, and
 * the affordance that sends the reader into the terminal.
 *
 * The terminal link is the point of a share, not decoration — a snapshot is
 * where someone lands, the live workspace is where they should end up.
 */

import { useEffect, type ReactNode } from "react";

export function formatShareTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface ShareShellProps {
  layout?: "document" | "wide";
  /** Destination that opens this view live in the terminal. */
  openInTerminalHref?: string | null;
  openInTerminalLabel?: string;
  children: ReactNode;
}

export function ShareShell({
  layout = "document",
  openInTerminalHref,
  openInTerminalLabel = "Open in terminal",
  children,
}: ShareShellProps) {
  return (
    <>
      <header className="share-header">
        <a className="share-back" href="/">&laquo; Back to Gloomberb</a>
        {openInTerminalHref ? (
          <a className="share-open" href={openInTerminalHref}>{openInTerminalLabel}</a>
        ) : null}
      </header>
      <main className="share-main" data-layout={layout}>{children}</main>
    </>
  );
}

export interface ShareMetaEntry {
  label?: string;
  value: string;
  href?: string;
}

export function ShareHeading({
  title,
  subtitle,
  meta,
}: {
  title: string;
  subtitle?: string | null;
  meta: readonly ShareMetaEntry[];
}) {
  const entries = meta.filter((entry) => entry.value);
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · Gloomberb` : previous;
    return () => { document.title = previous; };
  }, [title]);
  return (
    <>
      <h1 className="share-title">{title}</h1>
      {subtitle ? <p className="share-subtitle">{subtitle}</p> : null}
      {entries.length > 0 ? (
        <div className="share-meta">
          {entries.map((entry) => (
            <span key={`${entry.label ?? ""}${entry.value}`}>
              {entry.label ? <span className="share-meta-label">{entry.label} </span> : null}
              {entry.href
                ? <a href={entry.href} target="_blank" rel="noreferrer noopener">{entry.value}</a>
                : entry.value}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function ShareStatus({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="share-status">
      <div className="share-status-title">{title}</div>
      {detail ? <div>{detail}</div> : null}
      <a className="share-open" href="/">Open Gloomberb</a>
    </div>
  );
}
