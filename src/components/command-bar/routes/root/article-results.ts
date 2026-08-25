import { useEffect, useState } from "react";
import type { NewsArticle, NewsQueryPhase } from "../../../../news/types";
import { t } from "../../../../i18n";
import { searchAdjacentRelatedArticles } from "../../../../plugins/builtin/adjacent/news";
import {
  adjacentArticleSearchText,
  looksLikeArticleQuery,
  searchNewsArticles,
} from "../../../../plugins/builtin/news/wire/article-search";
import { looksLikeFilingQuery } from "../../../../plugins/builtin/sec/filing-article";
import {
  cachedPeriodicFilingArticles,
  searchPeriodicFilingArticles,
} from "../../../../plugins/builtin/sec/filing-search";
import type { ResultItem } from "../../list/model";

export function looksLikeWrittenTextQuery(query: string): boolean {
  return looksLikeArticleQuery(query) || looksLikeFilingQuery(query);
}

export function useAdjacentArticleSearch(query: string): {
  articles: NewsArticle[];
  phase: NewsQueryPhase;
} {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [phase, setPhase] = useState<NewsQueryPhase>("idle");

  useEffect(() => {
    const searchText = looksLikeArticleQuery(query) ? adjacentArticleSearchText(query) : null;
    if (!searchText) {
      setArticles([]);
      setPhase("idle");
      return;
    }

    let cancelled = false;
    setPhase("loading");
    const timer = setTimeout(() => {
      void searchAdjacentRelatedArticles(searchText).then((found) => {
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

export function useFilingArticleSearch(query: string): {
  articles: NewsArticle[];
  phase: NewsQueryPhase;
} {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [phase, setPhase] = useState<NewsQueryPhase>("idle");

  useEffect(() => {
    if (!looksLikeFilingQuery(query)) {
      setArticles([]);
      setPhase("idle");
      return;
    }

    const cached = cachedPeriodicFilingArticles(query);
    setArticles(cached);
    setPhase(cached.length > 0 ? "ready" : "loading");

    let cancelled = false;
    const timer = setTimeout(() => {
      void searchPeriodicFilingArticles(query).then((found) => {
        if (cancelled) return;
        setArticles(found);
        setPhase("ready");
      }).catch(() => {
        if (cancelled) return;
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
  if (!query || !looksLikeWrittenTextQuery(query)) return [];

  const matches = searchNewsArticles(options.articles, query);
  const items = matches.map((article) => ({
    id: `article:${article.id}`,
    label: article.title,
    detail: article.source,
    category: article.origin === "sec-edgar" ? "Filings" : "Articles",
    kind: "action" as const,
    right: article.origin === "sec-edgar" ? "10K" : "ART",
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
      "filing",
      "10-k",
      "10-q",
    ].join(" "),
    action: () => options.onOpen(article),
  }));

  if (items.length > 0) return items;
  if (options.phase === "loading" || options.phase === "refreshing") {
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

