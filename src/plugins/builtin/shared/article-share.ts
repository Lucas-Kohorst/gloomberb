import { useCallback } from "react";
import type { NewsArticle } from "../../../news/types";
import type { SubstackArticleDetail, SubstackArticleSummary } from "../substack/types";
import type { ChangelogRelease } from "../../../updater/github-releases";
import { useRendererHost } from "../../../ui";
import { getBrowserLocation } from "../../../utils/browser-location";
import { parseDisplayDate } from "../../../utils/datetime-format";
import { usePluginAppActions } from "../../runtime";
import { createShare } from "../../../sources/share-service";
import {
  decodeArticleSharePayload,
  encodeArticleSharePayload,
  type ArticleSharePayload,
} from "../../../shares/payload";
import {
  buildInlineArticleShareUrl,
  buildShortShareUrl,
} from "../../../shares/routes";

export { decodeArticleSharePayload };
export type { ArticleShareStoryItem, ArticleSharePayload } from "../../../shares/payload";
export { SHARE_HOSTED_ORIGIN } from "../../../shares/routes";

function toDateISO(value: Date | string | null | undefined): string | undefined {
  return parseDisplayDate(value)?.toISOString();
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

export function newsArticleSharePayload(article: NewsArticle): ArticleSharePayload {
  return {
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
}

/**
 * Changelog releases travel as news-shaped article payloads so a shared link
 * opens in the same reader, for anyone, without an account.
 */
export function changelogReleaseSharePayload(release: ChangelogRelease): ArticleSharePayload {
  return {
    type: "news",
    id: `changelog:${release.id}`,
    title: release.title || release.version || release.tagName,
    url: release.url,
    source: "Gloomberb Changelog",
    summary: release.body,
    publishedAt: release.publishedAt,
  };
}

export function substackArticleSharePayload(
  article: SubstackArticleSummary,
  detail?: SubstackArticleDetail | null,
): ArticleSharePayload {
  const source = detail ?? article;
  const bodyHtml = source.bodyHtml?.trim() || undefined;
  const contentText = detail?.contentText?.trim() || undefined;
  return {
    type: "substack",
    id: article.id,
    title: source.title || article.title,
    url: source.url ?? article.url ?? "",
    source: source.publicationName ?? article.publicationName ?? "",
    summary: contentText || source.previewText || undefined,
    subtitle: source.subtitle ?? article.subtitle ?? undefined,
    publicationName: source.publicationName ?? article.publicationName ?? undefined,
    publicationBaseUrl: source.publicationBaseUrl ?? article.publicationBaseUrl ?? undefined,
    slug: source.slug ?? article.slug ?? undefined,
    previewText: article.previewText ?? undefined,
    bodyHtml,
    imageUrls: source.imageUrls.length > 0 ? source.imageUrls : article.imageUrls,
    wordCount: source.wordCount || article.wordCount || undefined,
    readMinutes: source.readMinutes || article.readMinutes || undefined,
    publishedAt: source.publishedAt ?? article.publishedAt ?? undefined,
  };
}

/** @deprecated Prefer `newsArticleSharePayload` + short-ID share. Kept for legacy `/article?a=` links. */
export function encodeNewsArticleForShare(article: NewsArticle): string {
  return encodeArticleSharePayload(newsArticleSharePayload(article));
}

/** @deprecated Prefer `changelogReleaseSharePayload` + short-ID share. */
export function encodeChangelogReleaseForShare(release: ChangelogRelease): string {
  return encodeArticleSharePayload(changelogReleaseSharePayload(release));
}

/** @deprecated Prefer `substackArticleSharePayload` + short-ID share. */
export function encodeSubstackArticleForShare(article: SubstackArticleSummary): string {
  return encodeArticleSharePayload(substackArticleSharePayload(article));
}

/**
 * Returns true only for a decodable public article URL in a browser.
 *
 * Keep this check independent of the renderer so the app bootstrap can use it
 * before the deep-link bridge has mounted. New shares use `/s/{id}`; the
 * inline shape stays so older links still bypass the login gate.
 */
export function isPublicArticleShareLocation(): boolean {
  const location = getBrowserLocation();
  if (!location) return false;
  if (location.pathname !== "/article") return false;
  const encoded = new URLSearchParams(location.search).get("a");
  return encoded != null && decodeArticleSharePayload(encoded) !== null;
}

// ---------------------------------------------------------------------------
// URL builder (legacy inline form)
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
  const previewText = longerShareText(payload.summary, payload.previewText);
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
    previewText,
    bodyHtml: payload.bodyHtml ?? previewText,
    imageUrls: payload.imageUrls ?? [],
    wordCount: payload.wordCount ?? 0,
    readMinutes: payload.readMinutes ?? 0,
  };
}

function longerShareText(
  ...values: Array<string | null | undefined>
): string | null {
  let best: string | null = null;
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && (!best || trimmed.length > best.length)) best = trimmed;
  }
  return best;
}

// ---------------------------------------------------------------------------
// React hook — stores a short-ID share and copies the compact URL
// ---------------------------------------------------------------------------

/**
 * Prefer a short `/s/{id}` link. Fall back to the inline `/article?a=…` form
 * when the hosted share API is unreachable (desktop terminal, offline).
 */
export function useCopyShareLink(): (payload: ArticleSharePayload) => Promise<void> {
  const rendererHost = useRendererHost();
  const { notify } = usePluginAppActions();

  return useCallback(
    async (payload: ArticleSharePayload) => {
      try {
        const { id } = await createShare({ kind: "article", data: payload });
        await rendererHost.copyText(buildShortShareUrl(id));
        notify({ body: "Share link copied to clipboard", type: "success" });
      } catch {
        try {
          const shareUrl = buildInlineArticleShareUrl(encodeArticleSharePayload(payload));
          await rendererHost.copyText(shareUrl);
          notify({ body: "Share link copied to clipboard", type: "success" });
        } catch {
          notify({ body: "Failed to copy share link", type: "error" });
        }
      }
    },
    [rendererHost, notify],
  );
}
