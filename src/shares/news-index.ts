/**
 * Hosted KV index from a stable news article id to a Cloud share id.
 *
 * Cloud still stores the snapshot. This mapping is what makes `/news/{id}`
 * resolve without a public news corpus keyed by article id.
 */

import { parseSharePayload, type SharePayload } from "./payload";
import { isStoredShareId } from "./routes";

export const NEWS_INDEX_KEY_PREFIX = "news:";
export const NEWS_INDEX_TTL_SECONDS = 60 * 60 * 24 * 30;

export function newsIndexKey(articleId: string): string {
  return `${NEWS_INDEX_KEY_PREFIX}${articleId}`;
}

export interface NewsIndexRecord {
  shareId: string;
  verifiedArticle?: SharePayload;
}

export function parseNewsIndexRecord(value: unknown): NewsIndexRecord | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isStoredShareId(trimmed)) return { shareId: trimmed };
    try {
      return parseNewsIndexRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const shareId = (value as { shareId?: unknown }).shareId;
  if (typeof shareId !== "string" || !isStoredShareId(shareId)) return null;
  const object = value as Record<string, unknown>;
  const article = object.provenanceVersion === 1 ? parseSharePayload(object.verifiedArticle) : null;
  return { shareId, ...(article?.kind === "article" ? { verifiedArticle: article } : {}) };
}

export function serializeNewsIndexRecord(shareId: string, verifiedArticle?: SharePayload): string {
  return JSON.stringify({ shareId, ...(verifiedArticle ? { provenanceVersion: 1, verifiedArticle } : {}) });
}
