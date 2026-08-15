import { newsProvider, type NewsCapability } from "../../../capabilities";
import type { NewsArticle, NewsQuery } from "../../../types/news-source";
import type { AdjacentClient } from "./client";
import { normalizeAdjacentNewsArticle } from "./normalize";

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
