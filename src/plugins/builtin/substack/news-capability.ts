import { newsProvider, type NewsCapability } from "../../../capabilities";
import type { NewsArticle, NewsQuery } from "../../../news/types";
import type { SubstackArticleSummary } from "./types";
import { extractArticleContent } from "./content";
import { extractArticleTickersFromParts } from "../../../news/article-tickers";
import { loadSubstackHome } from "./api/loaders";
import { readResource } from "./api/store";
import { SubstackAuthError } from "./api/types";
import { withConnectionRequest } from "../connections/register";

const SUBSTACK_FEED_CACHE_KIND = "feed";
const SUBSTACK_FEED_CACHE_KEY = "subscribed";
const SUBSTACK_NEWS_HEAD_LIMIT = 200;

function supports(query: NewsQuery): boolean {
  const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
  return feed === "latest";
}

/**
 * Normalises a Substack article summary into the shared NewsArticle shape so
 * the firehose and article reader open it unchanged.
 */
export function normalizeSubstackArticle(article: SubstackArticleSummary): NewsArticle | null {
  const url = article.url?.trim() || null;
  if (!url) return null;

  const publishedAt = article.publishedAt ? new Date(article.publishedAt) : null;
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;

  // List rows persist without HTML. If a summary still has bodyHtml (open
  // detail / tests), extract it so Firehose can read subscriber-only posts.
  const body = article.bodyHtml
    ? extractArticleContent(article.bodyHtml, {
      baseUrl: article.publicationBaseUrl,
      title: article.title,
    }).text
    : "";

  return {
    body: body || undefined,
    id: `substack:${article.id}`,
    title: article.title,
    url,
    source: article.publicationName ?? "Substack",
    publishedAt,
    summary: article.subtitle ?? article.previewText ?? undefined,
    imageUrl: article.imageUrls[0] ?? undefined,
    topic: "general",
    topics: [],
    sectors: [],
    categories: ["newsletter"],
    tickers: extractArticleTickersFromParts([
      article.title,
      article.subtitle,
      article.previewText,
    ]),
    scores: {
      importance: 50,
      urgency: 0,
      marketImpact: 0,
      novelty: 0,
      confidence: 0,
    },
    isBreaking: false,
    isDeveloping: false,
    importance: 50,
  };
}

function cachedFeedItems(value: unknown): SubstackArticleSummary[] {
  if (Array.isArray(value)) return value as SubstackArticleSummary[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: SubstackArticleSummary[] }).items;
  }
  return [];
}

function newsHeadLimit(query: NewsQuery): number {
  return Math.min(query.limit ?? SUBSTACK_NEWS_HEAD_LIMIT, SUBSTACK_NEWS_HEAD_LIMIT);
}

function normalizeAll(items: SubstackArticleSummary[], limit: number): NewsArticle[] {
  const articles: NewsArticle[] = [];
  for (const item of items) {
    const article = normalizeSubstackArticle(item);
    if (!article) continue;
    articles.push(article);
    if (articles.length >= limit) break;
  }
  return articles;
}

/**
 * A NewsCapability adapter that wraps the existing Substack client. Reuses
 * `loadSubstackHome` (and its caching) — no new HTTP client is introduced.
 * When the user is not authenticated, returns an empty list so the firehose
 * still renders articles from every other source.
 */
export function createSubstackNewsCapability(): NewsCapability {
  return newsProvider({
    id: "substack-news",
    name: "Substack",
    priority: 800,
    provider: {
      supports,
      getCachedNews(query: NewsQuery): NewsArticle[] {
        if (!supports(query)) return [];
        try {
          const cached = readResource<unknown>(
            SUBSTACK_FEED_CACHE_KIND,
            SUBSTACK_FEED_CACHE_KEY,
            true,
          );
          return normalizeAll(cachedFeedItems(cached?.value), newsHeadLimit(query));
        } catch {
          return [];
        }
      },
      async fetchNews(query: NewsQuery): Promise<NewsArticle[]> {
        if (!supports(query)) return [];
        try {
          const home = await withConnectionRequest("substack", "home-feed", () =>
            loadSubstackHome(),
          );
          return normalizeAll(home.feed, newsHeadLimit(query));
        } catch (error) {
          if (error instanceof SubstackAuthError) return [];
          throw error;
        }
      },
    },
  });
}
