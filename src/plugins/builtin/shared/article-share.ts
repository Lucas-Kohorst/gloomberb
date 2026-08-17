import { useCallback } from "react";
import type { NewsArticle } from "../../../news/types";
import type { SubstackArticleSummary } from "../substack/types";
import type { ChangelogRelease } from "../../../updater/github-releases";
import { useRendererHost } from "../../../ui";
import { getBrowserLocation } from "../../../utils/browser-location";
import { usePluginAppActions } from "../../runtime";
import {
  decodeArticleSharePayload,
  encodeArticleSharePayload,
  type ArticleSharePayload,
} from "../../../shares/payload";
import { buildInlineArticleShareUrl } from "../../../shares/routes";

export { decodeArticleSharePayload };
export type { ArticleShareStoryItem, ArticleSharePayload } from "../../../shares/payload";
export { SHARE_HOSTED_ORIGIN } from "../../../shares/routes";

function toDateISO(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// ---------------------------------------------------------------------------
// Encode functions
// ---------------------------------------------------------------------------

export function encodeNewsArticleForShare(article: NewsArticle): string {
  const payload: ArticleSharePayload = {
    type: "news",
    id: article.id,
    title: article.title,
    url: article.url,
    source: article.source,
    summary: article.summary,
    publishedAt: toDateISO(article.publishedAt),
    topics: article.topics,
    categories: article.categories,
    tickers: article.tickers,
    importance: article.importance,
    items: article.items?.map((item) => ({
      id: item.id,
      sourceKey: item.sourceKey,
      sourceName: item.sourceName,
      title: item.title,
      summary: item.summary,
      url: item.url,
      publishedAt: toDateISO(item.publishedAt) ?? new Date(0).toISOString(),
    })),
  };
  return encodeArticleSharePayload(payload);
}

/**
 * Changelog releases travel as news-shaped article payloads so a shared link
 * opens in the same reader, for anyone, without an account.
 */
export function encodeChangelogReleaseForShare(release: ChangelogRelease): string {
  const payload: ArticleSharePayload = {
    type: "news",
    id: `changelog:${release.id}`,
    title: release.title || release.version || release.tagName,
    url: release.url,
    source: "Gloomberb Changelog",
    summary: release.body,
    publishedAt: release.publishedAt,
  };
  return encodeArticleSharePayload(payload);
}

export function encodeSubstackArticleForShare(article: SubstackArticleSummary): string {
  const payload: ArticleSharePayload = {
    type: "substack",
    id: article.id,
    title: article.title,
    url: article.url ?? "",
    source: article.publicationName ?? "",
    summary: article.previewText ?? undefined,
    subtitle: article.subtitle ?? undefined,
    publicationName: article.publicationName ?? undefined,
    publicationBaseUrl: article.publicationBaseUrl ?? undefined,
    slug: article.slug ?? undefined,
    previewText: article.previewText ?? undefined,
    bodyHtml: article.bodyHtml ?? undefined,
    imageUrls: article.imageUrls,
    wordCount: article.wordCount || undefined,
    readMinutes: article.readMinutes || undefined,
    publishedAt: article.publishedAt ?? undefined,
  };
  return encodeArticleSharePayload(payload);
}

/**
 * Returns true only for a decodable public article URL in a browser.
 *
 * Keep this check independent of the renderer so the app bootstrap can use it
 * before the deep-link bridge has mounted.
 */
export function isPublicArticleShareLocation(): boolean {
  const location = getBrowserLocation();
  if (!location) return false;
  if (location.pathname !== "/article") return false;
  const encoded = new URLSearchParams(location.search).get("a");
  return encoded != null && decodeArticleSharePayload(encoded) !== null;
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

export function buildShareUrl(encodedPayload: string): string {
  return buildInlineArticleShareUrl(encodedPayload);
}

// ---------------------------------------------------------------------------
// Reconstruction (for deep link resolution)
// ---------------------------------------------------------------------------

export function payloadToNewsArticle(payload: ArticleSharePayload): NewsArticle {
  const publishedAt = payload.publishedAt ? new Date(payload.publishedAt) : new Date(0);
  return {
    id: payload.id,
    title: payload.title,
    url: payload.url,
    source: payload.source,
    publishedAt,
    summary: payload.summary,
    topic: payload.topics?.[0] ?? "general",
    topics: payload.topics ?? [],
    sectors: [],
    categories: payload.categories ?? [],
    tickers: payload.tickers ?? [],
    scores: {
      importance: payload.importance ?? 0,
      urgency: 0,
      marketImpact: 0,
      novelty: 0,
      confidence: 0,
    },
    isBreaking: false,
    isDeveloping: false,
    importance: payload.importance ?? 0,
    items: payload.items?.map((item) => ({
      id: item.id,
      sourceKey: item.sourceKey,
      sourceName: item.sourceName,
      title: item.title,
      summary: item.summary,
      url: item.url,
      publishedAt: new Date(item.publishedAt),
    })),
  };
}

export function payloadToSubstackArticle(payload: ArticleSharePayload): SubstackArticleSummary {
  return {
    id: payload.id,
    title: payload.title,
    publicationId: null,
    publicationName: payload.publicationName ?? null,
    publicationSubdomain: null,
    publicationBaseUrl: payload.publicationBaseUrl ?? null,
    url: payload.url || null,
    slug: payload.slug ?? null,
    publishedAt: payload.publishedAt ?? null,
    subtitle: payload.subtitle ?? null,
    previewText: payload.previewText ?? null,
    bodyHtml: payload.bodyHtml ?? null,
    imageUrls: payload.imageUrls ?? [],
    wordCount: payload.wordCount ?? 0,
    readMinutes: payload.readMinutes ?? 0,
  };
}

// ---------------------------------------------------------------------------
// React hook — copies share URL to clipboard with confirmation feedback
// ---------------------------------------------------------------------------

export function useCopyShareLink(): (encodedPayload: string) => Promise<void> {
  const rendererHost = useRendererHost();
  const { notify } = usePluginAppActions();

  return useCallback(
    async (encodedPayload: string) => {
      const shareUrl = buildShareUrl(encodedPayload);
      try {
        await rendererHost.copyText(shareUrl);
        notify({ body: "Share link copied to clipboard", type: "success" });
      } catch {
        notify({ body: "Failed to copy share link", type: "error" });
      }
    },
    [rendererHost, notify],
  );
}
