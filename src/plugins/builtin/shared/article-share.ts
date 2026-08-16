import { useCallback } from "react";
import type { NewsArticle } from "../../../news/types";
import type { SubstackArticleSummary } from "../substack/types";
import { useRendererHost } from "../../../ui";
import { usePluginAppActions } from "../../runtime";

/**
 * The hosted web origin. Share URLs always point here so that a logged-out
 * stranger can open them in any browser without needing the desktop app.
 */
export const SHARE_HOSTED_ORIGIN = "https://terminal.kohor.st";

export interface ArticleShareStoryItem {
  id: string;
  sourceKey: string;
  sourceName: string;
  title: string;
  summary?: string;
  url: string;
  publishedAt: string;
}

export interface ArticleSharePayload {
  type: "news" | "substack";
  id: string;
  title: string;
  url: string;
  source: string;
  summary?: string;
  publishedAt?: string;
  topics?: string[];
  categories?: string[];
  tickers?: string[];
  importance?: number;
  items?: ArticleShareStoryItem[];
  // Substack-specific
  subtitle?: string;
  publicationName?: string;
  publicationBaseUrl?: string;
  slug?: string;
  previewText?: string;
  bodyHtml?: string;
  imageUrls?: string[];
  wordCount?: number;
  readMinutes?: number;
}

// ---------------------------------------------------------------------------
// Base64url helpers (work in browser, Node, and Bun)
// ---------------------------------------------------------------------------

function base64urlEncode(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(data, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
    if (typeof atob === "function") {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

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
  return base64urlEncode(JSON.stringify(payload));
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
  return base64urlEncode(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Decode function
// ---------------------------------------------------------------------------

export function decodeArticleSharePayload(encoded: string): ArticleSharePayload | null {
  const json = base64urlDecode(encoded);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.id !== "string" || typeof parsed.title !== "string" || typeof parsed.url !== "string") {
      return null;
    }
    if (parsed.type !== "news" && parsed.type !== "substack") return null;
    return parsed as ArticleSharePayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

export function buildShareUrl(encodedPayload: string): string {
  return `${SHARE_HOSTED_ORIGIN}/article?a=${encodedPayload}`;
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
