import type { NewsArticle } from "../../../../news/types";
import {
  looksLikeArticleQuery,
  searchNewsArticles,
} from "../../../../plugins/builtin/news/wire/article-search";
import type { ResultItem } from "../../list/model";

/**
 * Builds command-bar rows for an article-lookup (`ART`) query by matching the
 * typed text against the loaded news feed. Returns an empty list when the query
 * does not look like an article search so ordinary command matching is
 * unaffected.
 */
export function buildArticleSearchResultItems(options: {
  articles: readonly NewsArticle[];
  query: string;
  onOpen: (article: NewsArticle) => void;
}): ResultItem[] {
  const query = options.query.trim();
  if (!query || !looksLikeArticleQuery(query)) return [];

  const matches = searchNewsArticles(options.articles, query);
  return matches.map((article) => ({
    id: `article:${article.id}`,
    label: article.title,
    detail: article.source,
    category: "Articles",
    kind: "action" as const,
    right: "ART",
    searchText: [
      article.title,
      article.source,
      article.summary ?? "",
      ...article.topics,
      ...article.categories,
      "article",
      "news",
      "press",
    ].join(" "),
    action: () => options.onOpen(article),
  }));
}
