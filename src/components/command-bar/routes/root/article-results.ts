import { useEffect, useState } from "react";
import type { NewsArticle, NewsQueryPhase } from "../../../../news/types";
import { t } from "../../../../i18n";
import { searchAdjacentRelatedArticles } from "../../../../plugins/builtin/adjacent/news";
import {
  looksLikeArticleQuery,
  searchNewsArticles,
  tokenizeArticleQuery,
} from "../../../../plugins/builtin/news/wire/article-search";
import type { ResultItem } from "../../list/model";

export function useAdjacentArticleSearch(query: string): {
  articles: NewsArticle[];
  phase: NewsQueryPhase;
} {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [phase, setPhase] = useState<NewsQueryPhase>("idle");

  useEffect(() => {
    if (!looksLikeArticleQuery(query) || tokenizeArticleQuery(query).length === 0) {
      setArticles([]);
      setPhase("idle");
      return;
    }

    let cancelled = false;
    setPhase("loading");
    const timer = setTimeout(() => {
      void searchAdjacentRelatedArticles(tokenizeArticleQuery(query).join(" ")).then((found) => {
        if (cancelled) return;
        setArticles(found);
        setPhase("ready");
      });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { articles, phase };
}

export function buildArticleSearchResultItems(options: {
  articles: readonly NewsArticle[];
  query: string;
  phase: NewsQueryPhase;
  onOpen: (article: NewsArticle) => void;
}): ResultItem[] {
  const query = options.query.trim();
  if (!query || !looksLikeArticleQuery(query)) return [];

  const matches = searchNewsArticles(options.articles, query);
  const items = matches.map((article) => ({
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
      "adjacent",
      "press",
    ].join(" "),
    action: () => options.onOpen(article),
  }));

  if (items.length > 0) return items;
  if (options.phase === "loading" || options.phase === "idle" || options.phase === "refreshing") {
    return [{
      id: "article:loading",
      label: t("Looking up articles…"),
      detail: "",
      category: "Articles",
      kind: "info",
      // A placeholder that answers nothing; plain Enter must fall through to a
      // real local match (e.g. the top-news pane template) instead of stalling.
      defaultSelectable: false,
      action: () => {},
    }];
  }
  return [];
}
