import { newsOriginLabel } from "../../../../news/origins";
import type { NewsArticle } from "../../../../news/types";

/**
 * Filters a news list by a free-text query. Matches against title, source,
 * origin, summary, tickers, topics, and categories so a single search box
 * narrows across all provenance — same behavior as firehose / saved / presets.
 */
export function filterNewsArticles<T extends NewsArticle>(
  articles: readonly T[],
  query: string,
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return articles as T[];
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return articles as T[];

  return articles.filter((article) => {
    const haystack = [
      article.title,
      article.source,
      newsOriginLabel(article.origin),
      article.summary ?? "",
      ...article.tickers,
      ...article.topics,
      ...article.categories,
    ]
      .join(" ")
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}
