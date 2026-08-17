/** @jsxImportSource react */
/**
 * Chrome for the slim share page: one focused pane, not a landing page.
 *
 * Header/footer/hints mirror the hosted web pane (grip, title, `[o]pen live`)
 * so a snapshot reads as the same surface the sharer was looking at. The
 * terminal link is the point of a share — a snapshot is where someone lands,
 * the live workspace is where they should end up.
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
  title?: string;
  footer?: ReactNode;
  /** Destination that opens this view live in the terminal. */
  openInTerminalHref?: string | null;
  children: ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function ShareShell({
  layout = "document",
  title,
  footer,
  openInTerminalHref,
  children,
}: ShareShellProps) {
  const heading = title?.trim() || "Gloomberb";
  const openLabel = openInTerminalHref === "/" ? "pen gloomberb" : "pen live";
  const openAria = openInTerminalHref === "/" ? "Open Gloomberb" : "Open live in terminal";

  useEffect(() => {
    const previous = document.title;
    document.title = title?.trim() ? `${title.trim()} · Gloomberb` : previous;
    return () => { document.title = previous; };
  }, [title]);

  useEffect(() => {
    if (!openInTerminalHref) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key !== "o" && event.key !== "O") return;
      event.preventDefault();
      window.location.assign(openInTerminalHref);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openInTerminalHref]);

  return (
    <div className="share-workspace">
      <section className="share-pane" data-layout={layout} data-focused="true">
        <header className="share-pane-header">
          <span className="share-pane-grip" aria-hidden="true">:: </span>
          <h1 className="share-pane-title">{heading}</h1>
          <nav className="share-pane-actions">
            <a className="share-pane-hint" href="/">« Back</a>
          </nav>
        </header>
        <div className="share-pane-body">{children}</div>
        <footer className="share-pane-footer" data-empty={!footer && !openInTerminalHref ? "true" : undefined}>
          <div className="share-pane-status">{footer}</div>
          {openInTerminalHref ? (
            <a
              className="share-pane-hint"
              href={openInTerminalHref}
              aria-label={openAria}
            >
              <span className="share-pane-hint-key">[o]</span>{openLabel}
            </a>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
