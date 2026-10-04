import type { NewsArticle } from "../../../../news/types";

/**
 * Filters a news list by a free-text query. Every word must appear in the
 * headline, source, summary, tickers, topics, or categories.
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
      article.summary ?? "",
      ...article.tickers,
      ...article.topics,
      ...article.categories,
    ].join(" ").toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function newsSearchEmptyCopy(
  query: string,
  fallback: { title: string; hint: string },
): { title: string; hint: string } {
  if (!query.trim()) return fallback;
  return {
    title: "No matching articles.",
    hint: "Clear the search.",
  };
}
