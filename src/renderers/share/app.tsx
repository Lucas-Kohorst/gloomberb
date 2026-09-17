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
  getArticleSlug,
  getNewsShare,
  getShare,
  openLiveShareUrl,
  parseShareId,
  type ShareRecord,
} from "../../shares/api";
import { LayoutShareView } from "./layout-view";
import { OwnerActions, ShareView } from "./view";
import { ArticleShareView } from "./article-view";
import { ChartShareView } from "./chart-view";
import { TableShareView } from "./table-view";
import {
  articleShareFromStored,
  chartShareFromStored,
  decodeArticleSharePayload,
  tableShareFromStored,
} from "../../shares/payload";
import {
  buildTerminalArticleUrl,
  buildTerminalShareUrl,
  parseArticleSlugPath,
  parseNewsArticleId,
  parseShortShareId,
} from "../../shares/routes";

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

function ShareRecordView({
  share,
  shareId,
  origin,
}: {
  share: ShareRecord;
  shareId: string;
  origin: string;
}) {
  const openInTerminalHref = buildTerminalShareUrl(shareId, origin);
  if (share.kind === "article") {
    return (
      <ArticleShareView
        payload={articleShareFromStored(share.data)}
        openInTerminalHref={openInTerminalHref}
      />
    );
  }
  if (share.kind === "chart") {
    return (
      <ChartShareView
        payload={chartShareFromStored(share.data)}
        openInTerminalHref={openInTerminalHref}
      />
    );
  }
  if (share.kind === "table") {
    return (
      <TableShareView
        payload={tableShareFromStored(share.data)}
        openInTerminalHref={openInTerminalHref}
      />
    );
  }
  return (
    <ShareView
      share={share}
      openLiveUrl={openLiveShareUrl(shareId)}
    />
  );
}

function ContentShareApp({ id, origin }: { id: string; origin: string }) {
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
    if (state.share.kind === "pane") {
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
    return <>
      <OwnerActions deleting={state.deleting === true} error={state.error} onDelete={state.share.ownedByViewer ? remove : undefined} />
      <ShareRecordView share={state.share} shareId={id} origin={origin} />
    </>;
  }
  return <main><h1>Gloomberb</h1><p>{state.error ?? "Loading shared view..."}</p></main>;
}

function NewsShareApp({ articleId, origin }: { articleId: string; origin: string }) {
  const [state, setState] = useState<{
    share?: ShareRecord;
    shareId?: string;
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    getNewsShare(articleId, (url, init) => fetch(url, { ...init, signal: controller.signal }))
      .then((share) => setState(share
        ? { share, shareId: share.id }
        : { error: "This article is unavailable or has expired." }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ error: "This article could not be loaded." });
      });
    return () => controller.abort();
  }, [articleId]);
  if (state.share && state.shareId) {
    return <ShareRecordView share={state.share} shareId={state.shareId} origin={origin} />;
  }
  return <main><h1>Gloomberb</h1><p>{state.error ?? "Loading shared view..."}</p></main>;
}

function ArticleSlugApp({ slug, origin }: { slug: string; origin: string }) {
  const [state, setState] = useState<{
    share?: ShareRecord;
    shareId?: string;
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    const fetchImpl = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: controller.signal });
    (async () => {
      try {
        const record = await getArticleSlug(slug, fetchImpl);
        if (controller.signal.aborted) return;
        if (!record) {
          setState({ error: "This article is unavailable or has expired." });
          return;
        }
        let share: ShareRecord | null = null;
        let shareId: string | undefined;
        try {
          const news = await getNewsShare(record.articleId, fetchImpl);
          if (news) {
            share = news;
            shareId = news.id;
          }
        } catch {
          // Indexed news is optional; the slug record may still point at a Cloud share.
        }
        if (!share && record.shareId) {
          share = await getShare(record.shareId, fetchImpl);
          shareId = record.shareId;
        }
        if (controller.signal.aborted) return;
        setState(share && shareId
          ? { share, shareId }
          : { error: "This article is unavailable or has expired." });
      } catch {
        if (!controller.signal.aborted) setState({ error: "This article could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [slug]);
  if (state.share && state.shareId) {
    return <ShareRecordView share={state.share} shareId={state.shareId} origin={origin} />;
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
  const articleSlug = parseArticleSlugPath(pathname);
  if (articleSlug) return <ArticleSlugApp slug={articleSlug} origin={location.origin} />;
  const newsId = parseNewsArticleId(pathname);
  if (newsId) return <NewsShareApp articleId={newsId} origin={location.origin} />;
  const shareId = parseShareId(pathname) ?? parseShortShareId(pathname);
  return shareId && shareId.length >= 8
    ? <ContentShareApp id={shareId} origin={location.origin} />
    : <main><h1>Gloomberb</h1><p>{parseShortShareId(pathname)
      ? "This older share link is unavailable. Ask the sender for a new link."
      : "Invalid share link."}</p></main>;
}
