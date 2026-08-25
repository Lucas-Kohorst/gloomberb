import type { NewsArticle } from "../../../news/types";
import { loadSecBrowserFilings } from "./client";
import { filingLookupQuery, filingToArticle, isPeriodicFiling } from "./filing-article";

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; articles: NewsArticle[] }>();

function cacheKey(query: string): string {
  return filingLookupQuery(query).toLowerCase() || "latest";
}

export async function searchPeriodicFilingArticles(query: string): Promise<NewsArticle[]> {
  const key = cacheKey(query);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.articles;
  const filings = await loadSecBrowserFilings(filingLookupQuery(query));
  const articles = filings.filter(isPeriodicFiling).map((filing) => filingToArticle(filing));
  cache.set(key, { at: Date.now(), articles });
  return articles;
}

export function cachedPeriodicFilingArticles(query: string): NewsArticle[] {
  return cache.get(cacheKey(query))?.articles ?? [];
}
