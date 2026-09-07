import { useState } from "react";
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
import { useDebouncedAbortableEffect } from "./use-debounced-effect";

export function looksLikeCftcQuery(query: string): boolean {
  return /\b(cftc|dcm|dco)\b/i.test(query);
}

/**
 * Whether the query should search the written-text corpus (articles, filings,
 * CFTC). The broad fallback — any token of 3+ chars — means free-text queries
 * also trigger a local wire lookup, not only ART/filing/CFTC-shaped ones.
 */
export function shouldSearchWrittenCorpus(query: string): boolean {
  if (looksLikeArticleQuery(query) || looksLikeFilingQuery(query) || looksLikeCftcQuery(query)) {
    return true;
  }
  return query.trim().split(/\s+/).some((token) => token.length >= 3);
}

export function useAdjacentArticleSearch(query: string): {
  articles: NewsArticle[];
  phase: NewsQueryPhase;
} {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [phase, setPhase] = useState<NewsQueryPhase>("idle");
  const searchText = looksLikeArticleQuery(query) ? adjacentArticleSearchText(query) : null;

  useDebouncedAbortableEffect(query, !!searchText, async (signal) => {
    if (!searchText) return;
    const found = await searchAdjacentRelatedArticles(searchText);
    if (signal.aborted) return;
    setArticles(found);
    setPhase("ready");
  }, {
    onEnable: () => setPhase("loading"),
    onDisable: () => { setArticles([]); setPhase("idle"); },
  });

  return { articles, phase };
}

export function useFilingArticleSearch(query: string): {
  articles: NewsArticle[];
  phase: NewsQueryPhase;
} {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [phase, setPhase] = useState<NewsQueryPhase>("idle");

  useDebouncedAbortableEffect(query, looksLikeFilingQuery(query), async (signal) => {
    try {
      const found = await searchPeriodicFilingArticles(query);
      if (signal.aborted) return;
      setArticles(found);
      setPhase("ready");
    } catch {
      if (signal.aborted) return;
      setPhase("ready");
    }
  }, {
    onEnable: () => {
      const cached = cachedPeriodicFilingArticles(query);
      setArticles(cached);
      setPhase(cached.length > 0 ? "ready" : "loading");
    },
    onDisable: () => { setArticles([]); setPhase("idle"); },
  });

  return { articles, phase };
}

export function buildArticleSearchResultItems(options: {
  articles: readonly NewsArticle[];
  query: string;
  phase: NewsQueryPhase;
  onOpen: (article: NewsArticle) => void;
}): ResultItem[] {
  const query = options.query.trim();
  if (!query || !shouldSearchWrittenCorpus(query)) return [];

  const matches = searchNewsArticles(options.articles, query);
  const items = matches.map((article) => ({
    id: `article:${article.id}`,
    label: article.title,
    detail: article.source,
    category: article.origin === "sec-edgar" || article.origin === "cftc" ? "Filings" : "Articles",
    kind: "action" as const,
    right: article.origin === "sec-edgar" ? "10K" : article.origin === "cftc" ? "CFTC" : "ART",
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
      defaultSelectable: false,
      action: () => {},
    }];
  }
  return [];
}
