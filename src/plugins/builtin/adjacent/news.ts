import { newsProvider, type NewsCapability } from "../../../capabilities";
import type { NewsArticle, NewsQuery } from "../../../types/news-source";
import { getSharedAdjacentClient, type AdjacentClient } from "./client";
import { normalizeAdjacentNewsArticle } from "./normalize";
import { filterAdjacentRows } from "./search";

const RELATED_MARKET_LIMIT = 4;

export async function searchAdjacentRelatedArticles(query: string): Promise<NewsArticle[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const client = getSharedAdjacentClient();
  try {
    const response = await client.searchMarkets(trimmed, RELATED_MARKET_LIMIT * 3);
    const rows = response.markets?.length ? response.markets : (response.data ?? []);
    const matched = filterAdjacentRows(
      rows,
      trimmed,
      (market) => [market.ticker, market.title, market.platform, market.id].filter(Boolean).join(" "),
    );
    const marketIds = matched.slice(0, RELATED_MARKET_LIMIT).map((market) => market.id);
    if (marketIds.length === 0) return [];
    const pages = await Promise.all(
      marketIds.map((marketId) => client.getMarketNews(marketId).catch(() => ({ news: [] }))),
    );
    const seen = new Set<string>();
    const articles: NewsArticle[] = [];
    for (const page of pages) {
      for (const article of page.news ?? []) {
        if (seen.has(article.id) || seen.has(article.url)) continue;
        seen.add(article.id);
        seen.add(article.url);
        articles.push(normalizeAdjacentNewsArticle(article));
      }
    }
    return articles;
  } catch {
    return [];
  }
}

export function createAdjacentNewsCapability(client: AdjacentClient): NewsCapability {
  function supports(query: NewsQuery): boolean {
    const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
    return feed === "latest" || feed === "top" || feed === "ticker";
  }

  async function fetchNews(query: NewsQuery): Promise<NewsArticle[]> {
    if (!supports(query)) return [];

    const limit = Math.min(query.limit ?? 50, 100);

    try {
      // For ticker-related queries, we don't have a direct ticker->news mapping,
      // but we can fetch latest news and filter by related market IDs / categories.
      if (query.feed === "latest" || (query.feed === "top" && !query.ticker)) {
        const response = query.feed === "top"
          ? await client.getNews({ limit })
          : await client.getLatestNews(limit);
        const articles = response.news ?? [];
        return articles.map(normalizeAdjacentNewsArticle);
      }

      // For ticker-specific or other queries, fetch general news
      const response = await client.getNews({ limit });
      const articles = response.news ?? [];
      return articles.map(normalizeAdjacentNewsArticle);
    } catch {
      return [];
    }
  }

  return newsProvider({
    id: "adjacent",
    name: "Adjacent News",
    priority: 500,
    provider: {
      supports,
      fetchNews,
    },
  });
}
