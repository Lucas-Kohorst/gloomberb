/** @jsxImportSource react */
import { useEffect, useState } from "react";
import {
  getPublicMarketplaceLayout,
  openLiveMarketplaceLayoutUrl,
  parseMarketplaceLayoutId,
} from "../../layout-marketplace/api";
import type { LayoutMarketplaceEntry } from "../../layout-marketplace/payload";
import {
  deleteShare,
  getShare,
  openLiveShareUrl,
  parseShareId,
  type ShareRecord,
} from "../../shares/api";
import { LayoutShareView } from "./layout-view";
import { ShareView } from "./view";
import { ArticleShareView } from "./article-view";
import { decodeArticleSharePayload } from "../../shares/payload";
import { buildTerminalArticleUrl, parseShortShareId } from "../../shares/routes";

function LayoutApp({ id }: { id: string }) {
  const [state, setState] = useState<{
    entry?: LayoutMarketplaceEntry;
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    getPublicMarketplaceLayout(
      id,
      (url, init) => fetch(url, { ...init, signal: controller.signal }),
    )
      .then((entry) => setState(entry
        ? { entry }
        : { error: "This shared layout is unavailable." }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ error: "This shared layout could not be loaded." });
      });
    return () => controller.abort();
  }, [id]);

  return state.entry
    ? <LayoutShareView entry={state.entry} openLiveUrl={openLiveMarketplaceLayoutUrl(id)} />
    : <main><h1>Gloomberb</h1><p>{state.error ?? "Loading shared layout..."}</p></main>;
}

function ContentShareApp({ id }: { id: string }) {
  const [state, setState] = useState<{
    share?: ShareRecord;
    error?: string;
    deleting?: boolean;
    deleted?: boolean;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    getShare(id, (url, init) => fetch(url, { ...init, signal: controller.signal }))
      .then((share) => setState(share ? { share } : { error: "This share is unavailable or has expired." }))
      .catch(() => { if (!controller.signal.aborted) setState({ error: "This share could not be loaded." }); });
    return () => controller.abort();
  }, [id]);
  const remove = async () => {
    if (!state.share?.ownedByViewer || state.deleting) return;
    setState((current) => ({ ...current, deleting: true, error: undefined }));
    try {
      await deleteShare(id);
      setState({ deleted: true });
    } catch (error) {
      setState((current) => ({
        ...current,
        deleting: false,
        error: error instanceof Error ? error.message : "Could not delete share.",
      }));
    }
  };
  if (state.deleted) return <main><h1>Share deleted</h1><p>This link is no longer available.</p></main>;
  if (state.share) {
    return (
      <ShareView
        share={state.share}
        openLiveUrl={openLiveShareUrl(id)}
        deleting={state.deleting === true}
        deleteError={state.error}
        onDelete={state.share.ownedByViewer ? remove : undefined}
      />
    );
  }
  return <main><h1>Gloomberb</h1><p>{state.error ?? "Loading shared view..."}</p></main>;
}

export function SocialShareApp({ location = window.location }: {
  location?: Pick<Location, "pathname" | "search" | "origin">;
}) {
  const pathname = location.pathname;
  if (pathname === "/article") {
    const encoded = new URLSearchParams(location.search).get("a");
    const article = encoded ? decodeArticleSharePayload(encoded) : null;
    return article && encoded
      ? <ArticleShareView payload={article} openInTerminalHref={buildTerminalArticleUrl(encoded, location.origin)} />
      : <main><h1>Gloomberb</h1><p>This article link could not be read.</p></main>;
  }
  const layoutId = parseMarketplaceLayoutId(pathname);
  if (layoutId) return <LayoutApp id={layoutId} />;
  if (pathname.startsWith("/l/")) return <main><h1>Gloomberb</h1><p>Invalid layout link.</p></main>;
  const shareId = parseShareId(pathname);
  return shareId
    ? <ContentShareApp id={shareId} />
    : <main><h1>Gloomberb</h1><p>{parseShortShareId(pathname)
      ? "This older share link is unavailable. Ask the sender for a new link."
      : "Invalid share link."}</p></main>;
}
