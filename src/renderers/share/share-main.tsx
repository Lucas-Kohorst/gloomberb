/** @jsxImportSource react */
/**
 * Entry point for the slim share page.
 *
 * This is a separate bundle from the terminal by design. A shared link is read
 * by someone who has no account, no layout, and no patience: it must not pay for
 * plugin registration, a session round-trip, a backend init RPC, or the panes
 * that make up a workspace. Everything here is the payload and a renderer for it.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  decodeArticleSharePayload,
  isSpecOnlyChartShare,
  parseSharePayload,
  type ArticleSharePayload,
  type SharePayload,
} from "../../shares/payload";
import {
  buildTerminalArticleUrl,
  buildTerminalShareUrl,
  parseShortShareId,
} from "../../shares/routes";
import { ArticleShareView } from "./article-view";
import { TableShareView } from "./table-view";
import { ShareShell } from "./shell";

// lightweight-charts is over half the weight of this page and only chart shares
// need it. Articles are the common case and must not download a charting engine
// to render a paragraph.
const ChartShareView = lazy(() => import("./chart-view").then((module) => ({
  default: module.ChartShareView,
})));

type ShareRoute =
  /** Inline article payload — renders on the first frame with no network. */
  | { kind: "inline-article"; payload: ArticleSharePayload; encoded: string }
  | { kind: "stored"; shortId: string }
  | { kind: "unknown" };

function resolveRoute(location: Location): ShareRoute {
  if (location.pathname === "/article") {
    const encoded = new URLSearchParams(location.search).get("a");
    const payload = encoded ? decodeArticleSharePayload(encoded) : null;
    if (payload && encoded) return { kind: "inline-article", payload, encoded };
    return { kind: "unknown" };
  }
  const shortId = parseShortShareId(location.pathname);
  return shortId ? { kind: "stored", shortId } : { kind: "unknown" };
}

function SharePayloadView({
  payload,
  openInTerminalHref,
}: {
  payload: SharePayload;
  openInTerminalHref: string | null;
}) {
  if (payload.kind === "article") {
    return <ArticleShareView payload={payload.data} openInTerminalHref={openInTerminalHref} />;
  }
  if (payload.kind === "chart") {
    return (
      <Suspense fallback={(
        <ShareShell layout="wide" title="Chart" openInTerminalHref={openInTerminalHref}>
          <div className="share-loading-body">Drawing chart&hellip;</div>
        </ShareShell>
      )}
      >
        <ChartShareView payload={payload.data} openInTerminalHref={openInTerminalHref} />
      </Suspense>
    );
  }
  return <TableShareView payload={payload.data} openInTerminalHref={openInTerminalHref} />;
}

type StoredState =
  | { status: "loading" }
  | { status: "ready"; payload: SharePayload }
  | { status: "missing" }
  | { status: "error"; message: string };

function StoredShareView({ shortId }: { shortId: string }) {
  const [state, setState] = useState<StoredState>({ status: "loading" });
  const terminalHref = buildTerminalShareUrl(shortId, window.location.origin);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/share/${encodeURIComponent(shortId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return setState({ status: "missing" });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const envelope = await response.json() as { kind?: unknown; data?: unknown };
        // Chart shares predating snapshots stored only a spec, which needs the
        // market-data stack to draw. The terminal has it; hand off rather than
        // showing a stranger an empty frame.
        if (envelope.kind === "chart" && isSpecOnlyChartShare(envelope.data)) {
          window.location.replace(terminalHref);
          return;
        }
        const payload = parseSharePayload(envelope.kind, envelope.data);
        setState(payload
          ? { status: "ready", payload }
          : { status: "error", message: "This share could not be read." });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load this share.",
        });
      });
    return () => controller.abort();
  }, [shortId, terminalHref]);

  if (state.status === "ready") {
    return <SharePayloadView payload={state.payload} openInTerminalHref={terminalHref} />;
  }
  if (state.status === "loading") {
    return (
      <ShareShell title="Share">
        <div className="share-loading-body">Loading shared view&hellip;</div>
      </ShareShell>
    );
  }
  if (state.status === "missing") {
    return (
      <ShareShell title="This share link has expired" openInTerminalHref={terminalHref}>
        <p className="share-note">Shared views are kept for 30 days.</p>
      </ShareShell>
    );
  }
  return (
    <ShareShell title="This share could not be opened" openInTerminalHref={terminalHref}>
      <p className="share-note">{state.message}</p>
    </ShareShell>
  );
}

function ShareApp({ route }: { route: ShareRoute }) {
  if (route.kind === "inline-article") {
    return (
      <ArticleShareView
        payload={route.payload}
        openInTerminalHref={buildTerminalArticleUrl(route.encoded, window.location.origin)}
      />
    );
  }
  if (route.kind === "stored") return <StoredShareView shortId={route.shortId} />;
  return (
    <ShareShell title="Not a share link" openInTerminalHref="/">
      <p className="share-note">This address does not point at a shared view.</p>
    </ShareShell>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element");
createRoot(rootElement).render(<ShareApp route={resolveRoute(window.location)} />);
