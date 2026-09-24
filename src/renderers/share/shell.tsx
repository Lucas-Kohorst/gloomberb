/** @jsxImportSource react */
/**
 * Chrome for the slim share page: one focused pane, not a landing page.
 *
 * Header/footer/hints mirror the hosted web pane (grip, title, `[o]pen live`)
 * so a snapshot reads as the same surface the sharer was looking at. The
 * terminal link is the point of a share — a snapshot is where someone lands,
 * the live workspace is where they should end up.
 */

import { useEffect, useState, type ReactNode } from "react";

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
  /**
   * `pane` is the terminal frame. `public` is the page a stranger should see
   * for an article, filing, or chart. `handoff` is a short card that sends a
   * whole list into the live terminal.
   */
  tone?: "pane" | "public" | "handoff";
  title?: string;
  /** One sentence under a public page, not a keyboard hint. */
  pitch?: string;
  footer?: ReactNode;
  /** Destination that opens this view live in the terminal. */
  openInTerminalHref?: string | null;
  onArchive?: (() => void) | null;
  archiveEnabled?: boolean;
  children: ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function sessionHasUser(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as { user?: unknown }).user != null;
}

function useHostedSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        if (sessionHasUser(await response.json())) setSignedIn(true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return signedIn;
}

export function ShareShell({
  layout = "document",
  tone = "pane",
  title,
  pitch,
  footer,
  openInTerminalHref,
  onArchive,
  archiveEnabled = false,
  children,
}: ShareShellProps) {
  const heading = title?.trim() || "Gloom";
  const signedIn = useHostedSignedIn();
  const openLabel = openInTerminalHref === "/" ? "pen gloomberb" : "pen live";
  const openAria = openInTerminalHref === "/" ? "Open Gloomberb" : "Open live in terminal";

  useEffect(() => {
    const previous = document.title;
    document.title = title?.trim() ? `${title.trim()} · Gloom` : previous;
    return () => { document.title = previous; };
  }, [title]);

  useEffect(() => {
    if (!openInTerminalHref && !onArchive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if ((event.key === "o" || event.key === "O") && openInTerminalHref) {
        event.preventDefault();
        const opened = window.open(openInTerminalHref, "_blank", "noopener,noreferrer");
        if (!opened) window.location.assign(openInTerminalHref);
        return;
      }
      if ((event.key === "a" || event.key === "A") && onArchive && archiveEnabled) {
        event.preventDefault();
        onArchive();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [archiveEnabled, onArchive, openInTerminalHref]);

  if (tone !== "pane") {
    return (
      <div className={tone === "handoff" ? "share-handoff" : "share-public"} data-layout={layout}>
        <header className="share-public-bar">
          <a className="share-wordmark" href="/">Gloomberb</a>
          <nav className="share-public-nav">
            {signedIn ? (
              <a className="share-login" href="/">Back</a>
            ) : (
              <>
                <a className="share-login" href="/?auth=login">Log in</a>
                <a className="share-signup" href="/?auth=signup">Sign up</a>
              </>
            )}
          </nav>
        </header>
        <div className="share-public-main">
          {title?.trim() ? <h1 className="share-public-title">{heading}</h1> : null}
          {children}
          {tone === "public" && layout !== "wide" ? (
            <footer className="share-doc-foot">
              <div className="share-doc-status">{footer}</div>
              <nav className="share-doc-actions">
                {onArchive && archiveEnabled ? (
                  <button type="button" className="share-text-button" onClick={onArchive}>Archive</button>
                ) : null}
                {openInTerminalHref ? (
                  <a href={openInTerminalHref}>Open live</a>
                ) : null}
              </nav>
            </footer>
          ) : (
            <div className="share-cta">
              {pitch ? <p>{pitch}</p> : null}
              {openInTerminalHref ? (
                <a className="share-signup" href={openInTerminalHref}>Open in Gloom</a>
              ) : signedIn ? (
                <a className="share-signup" href="/">Back</a>
              ) : (
                <a className="share-signup" href="/?auth=signup">Sign up</a>
              )}
              {footer ? <span className="share-cta-extra">{footer}</span> : null}
              {onArchive && archiveEnabled ? (
                <button type="button" className="share-text-button" onClick={onArchive}>Archive</button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="share-workspace">
      <section className="share-pane" data-layout={layout} data-focused="true">
        <header className="share-pane-header">
          <span className="share-pane-grip" aria-hidden="true">:: </span>
          <h1 className="share-pane-title">{heading}</h1>
          <nav className="share-pane-actions">
            {signedIn ? (
              <a className="share-pane-hint" href="/">« Back</a>
            ) : (
              <>
                <a className="share-pane-hint" href="/?auth=signup">Sign up</a>
                <a className="share-pane-hint" href="/?auth=login">Log in</a>
              </>
            )}
          </nav>
        </header>
        <div className="share-pane-body">{children}</div>
        <footer className="share-pane-footer" data-empty={!footer && !openInTerminalHref && !onArchive ? "true" : undefined}>
          <div className="share-pane-status">{footer}</div>
          <nav className="share-pane-hints">
          {onArchive && archiveEnabled ? (
            <button
              type="button"
              className="share-pane-hint"
              onClick={onArchive}
              aria-label="Archive publisher article"
            >
              <span className="share-pane-hint-key">[a]</span>rchive
            </button>
          ) : null}
          {openInTerminalHref ? (
            <a
              className="share-pane-hint"
              href={openInTerminalHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={openAria}
            >
              <span className="share-pane-hint-key">[o]</span>{openLabel}
            </a>
          ) : null}
          </nav>
        </footer>
      </section>
    </div>
  );
}
