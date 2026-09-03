import type { CommandResultDef, PaneTemplateCreateOptions } from "../../../../types/plugin";
import type { NewsArticle } from "../../../../news/types";
import { getSharedNewsService } from "../../../../news/hooks";
import { scheduleOnIdle } from "../../../../utils/schedule-on-idle";
import { NEWS_ARTICLE_READER_TEMPLATE_ID } from "../../shared/article-pop-out";
import { stashNewsArticle } from "./news/article-stash";

const ARTICLE_SEARCH_LIMIT = 8;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "on",
  "of",
  "in",
  "to",
  "for",
  "and",
  "or",
  "from",
  "with",
  "about",
  "by",
  "at",
  "as",
  "is",
  "are",
  "was",
  "be",
]);

const INTENT_WORDS = new Set([
  "article",
  "articles",
  "news",
  "headline",
  "headlines",
  "story",
  "stories",
  "rss",
  "feed",
  "feeds",
  "press",
]);

const COMMAND_WORDS = new Set([
  "open",
  "read",
  "show",
  "find",
  "search",
  "please",
  "me",
  "latest",
  "recent",
  "lookup",
  "look",
  "up",
]);

/** Headlines scored on the ART hot path — keep this well below a full firehose page. */
export const ARTICLE_SEARCH_POOL_LIMIT = 200;
export const ARTICLE_SEARCH_QUERY = { feed: "latest" as const, limit: ARTICLE_SEARCH_POOL_LIMIT };
/** Summary slice for ART scoring. Full body stays in the reader, not the command bar. */
export const ARTICLE_SEARCH_SUMMARY_LIMIT = 480;

/** Cap so Firehose / ART still fill within seconds, not minutes, after first paint. */
export const NEWS_WARM_IDLE_TIMEOUT_MS = 5_000;

let cancelNewsWarm: (() => void) | null = null;

/** Prefetch latest news (RSS, X, Substack, wire) without waiting for a pane to mount. */
export function scheduleLatestNewsWarm(): void {
  cancelRssNewsWarm();
  cancelNewsWarm = scheduleOnIdle(() => {
    cancelNewsWarm = null;
    void getSharedNewsService()?.poll(ARTICLE_SEARCH_QUERY);
  }, NEWS_WARM_IDLE_TIMEOUT_MS);
}

/** Prefetch RSS so Connections records traffic and ART has headlines without opening a pane. */
export function scheduleRssNewsWarm(): void {
  scheduleLatestNewsWarm();
}

export function cancelRssNewsWarm(): void {
  cancelNewsWarm?.();
  cancelNewsWarm = null;
}

const ARTICLE_TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;

export function tokenizeArticleQuery(query: string): string[] {
  // `ART trump` is the command prefix plus a topic — "art" is not a search term.
  const withoutArtPrefix = query.replace(/^\s*art\b/i, " ");
  return withoutArtPrefix
    .toLowerCase()
    .split(ARTICLE_TOKEN_SPLIT)
    .filter((token) => (
      token.length >= 2
      && !STOPWORDS.has(token)
      && !INTENT_WORDS.has(token)
      && !COMMAND_WORDS.has(token)
    ));
}

export function looksLikeArticleQuery(query: string): boolean {
  const tokens = query.toLowerCase().split(ARTICLE_TOKEN_SPLIT).filter(Boolean);
  if (tokens.some((token) => INTENT_WORDS.has(token))) return true;
  return /^\s*art\b/i.test(query);
}

/** Adjacent network lookup needs a 3+ char token. `ART tr` stays local; `ART trum` can go out. */
export function adjacentArticleSearchText(query: string): string | null {
  const tokens = tokenizeArticleQuery(query);
  if (!tokens.some((token) => token.length >= 3)) return null;
  return tokens.join(" ");
}

export function scoreArticleMatch(article: NewsArticle, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const title = (article.title ?? "").toLowerCase();
  const source = (article.source ?? "").toLowerCase();
  const summary = (article.summary ?? "").slice(0, ARTICLE_SEARCH_SUMMARY_LIMIT).toLowerCase();
  const haystack = [
    title,
    source,
    summary,
    ...(article.topics ?? []),
    ...(article.categories ?? []),
    ...(article.tickers ?? []),
  ].join(" ").toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 10;
    else if (source.includes(token)) score += 6;
    else if (haystack.includes(token)) score += 3;
    else return 0;
  }
  return score;
}

export function searchNewsArticles(
  articles: readonly NewsArticle[],
  query: string,
  limit = ARTICLE_SEARCH_LIMIT,
): NewsArticle[] {
  const tokens = tokenizeArticleQuery(query);
  if (tokens.length === 0) {
    return [...articles]
      .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())
      .slice(0, limit);
  }

  return articles
    .map((article) => ({ article, score: scoreArticleMatch(article, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.article.publishedAt.getTime() - left.article.publishedAt.getTime();
    })
    .slice(0, limit)
    .map((entry) => entry.article);
}

export function openNewsArticle(
  article: NewsArticle,
  createPaneFromTemplate: (templateId: string, options?: PaneTemplateCreateOptions) => void,
): void {
  stashNewsArticle(article);
  createPaneFromTemplate(NEWS_ARTICLE_READER_TEMPLATE_ID, {
    arg: article.id,
    values: {
      title: article.title,
      url: article.url,
      source: article.source,
    },
  });
}

export function buildOpenArticleCommandResults(
  articles: readonly NewsArticle[],
  query: string,
  createPaneFromTemplate: (templateId: string, options?: PaneTemplateCreateOptions) => void,
): CommandResultDef[] {
  const matches = searchNewsArticles(articles, query);
  return matches.map((article) => ({
    id: article.id,
    label: article.title,
    detail: article.source,
    category: "Articles",
    right: "ART",
    keywords: [
      article.title,
      article.source,
      article.summary ?? "",
      ...article.topics,
      ...article.categories,
      "article",
      "news",
      "adjacent",
      "press",
    ],
    execute: () => openNewsArticle(article, createPaneFromTemplate),
  }));
}

export function cachedNewsArticles(): NewsArticle[] {
  const service = getSharedNewsService();
  if (!service) return [];
  const pooled = service.getFirehose(undefined, ARTICLE_SEARCH_POOL_LIMIT);
  if (pooled.length > 0) return pooled;
  return service.getQueryState(ARTICLE_SEARCH_QUERY).articles;
}

export async function loadNewsArticles(): Promise<NewsArticle[]> {
  const service = getSharedNewsService();
  if (!service) return [];
  return (await service.load(ARTICLE_SEARCH_QUERY)).articles;
}
