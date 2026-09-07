import type { NewsArticle } from "../../../../news/types";
import { searchRelatedNews } from "./article-search";

/**
 * TTL cache with in-flight de-duplication for related-news lookups.
 *
 * Follows the same module-level Map pattern as the AdjacentClient's
 * `loadCached` / `inflightCached` pair: a `cache` Map holds the last result
 * with a loaded-at timestamp, and an `inflight` Map shares a single pending
 * promise across concurrent callers for the same key. `forceRefresh` bypasses
 * both maps so a manual refresh always re-fetches.
 */
const RELATED_NEWS_CACHE_TTL_MS = 30_000;

const cache = new Map<string, { articles: NewsArticle[]; loadedAt: number }>();
const inflight = new Map<string, Promise<NewsArticle[]>>();

function cacheKey(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function loadRelatedNews(query: string, forceRefresh = false): Promise<NewsArticle[]> {
  const key = cacheKey(query);
  if (!key) return Promise.resolve([]);

  const cached = cache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.loadedAt < RELATED_NEWS_CACHE_TTL_MS) {
    return Promise.resolve(cached.articles);
  }

  if (!forceRefresh) {
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const request = searchRelatedNews(query).then((articles) => {
    cache.set(key, { articles, loadedAt: Date.now() });
    return articles;
  }).finally(() => {
    if (inflight.get(key) === request) {
      inflight.delete(key);
    }
  });
  inflight.set(key, request);
  return request;
}
