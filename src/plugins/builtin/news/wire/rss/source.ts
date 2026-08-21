import { createThrottledFetch } from "../../../../../utils/throttled-fetch";
import { newsProvider, type NewsCapability } from "../../../../../capabilities";
import type { NewsQuery, MarketNewsItem } from "../../../../../types/news-source";
import type { PluginPersistence } from "../../../../../types/plugin";
import { parseRssFeed, type RssFeedConfig } from "./parser";
import { enrichNewsItem } from "../categories";
import { withConnectionRequest, reportConnectionRequest } from "../../../connections/register";
import {
  buildArticleTickerUniverse,
  type ArticleTickerUniverse,
} from "../../../../../news/article-tickers";

const RSS_CACHE_KIND = "rss-feed";
export const RSS_FEED_CACHE_POLICY = {
  staleMs: 2 * 60 * 1000,
  expireMs: 7 * 24 * 60 * 60 * 1000,
} as const;

interface CachedNewsItem extends Omit<MarketNewsItem, "publishedAt"> {
  publishedAt: string;
}

interface CachedFeedPayload {
  items: CachedNewsItem[];
}

const rssClient = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 1,
  timeoutMs: 10_000,
  defaultHeaders: {
    "User-Agent": "Gloomberb/0.4.1",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  },
});

export interface RssNewsCapabilityOptions {
  /** Resolved at fetch time so newly added tickers are matched without a restart. */
  knownTickers?: () => Promise<Set<string>>;
  tickerUniverse?: () => Promise<ArticleTickerUniverse>;
  persistence?: PluginPersistence;
  fetchText?: (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;
}

function supportsQuery(query: NewsQuery): boolean {
  const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
  return feed === "latest" || feed === "top";
}

function serializeItem(item: MarketNewsItem): CachedNewsItem {
  return {
    ...item,
    publishedAt: item.publishedAt.toISOString(),
  };
}

function deserializeItem(item: unknown): MarketNewsItem | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.title !== "string" || typeof record.url !== "string") return null;
  if (typeof record.source !== "string") return null;
  const publishedAt = new Date(String(record.publishedAt ?? ""));
  if (Number.isNaN(publishedAt.getTime())) return null;

  return {
    id: record.id,
    title: record.title,
    url: record.url,
    source: record.source,
    publishedAt,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    body: typeof record.body === "string" && record.body.trim() ? record.body : undefined,
    imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : undefined,
    topic: typeof record.topic === "string" ? record.topic : "general",
    topics: Array.isArray(record.topics)
      ? record.topics.filter((entry): entry is string => typeof entry === "string")
      : [],
    sectors: Array.isArray(record.sectors)
      ? record.sectors.filter((entry): entry is string => typeof entry === "string")
      : [],
    categories: Array.isArray(record.categories)
      ? record.categories.filter((entry): entry is string => typeof entry === "string")
      : [],
    tickers: Array.isArray(record.tickers)
      ? record.tickers.filter((entry): entry is string => typeof entry === "string")
      : [],
    sentiment:
      record.sentiment === "positive" || record.sentiment === "negative" || record.sentiment === "neutral"
        ? record.sentiment
        : undefined,
    scores: {
      importance: typeof record.importance === "number" ? record.importance : 0,
      urgency: record.isBreaking === true ? 80 : 0,
      marketImpact: typeof record.importance === "number" ? record.importance : 0,
      novelty: 0,
      confidence: 0,
    },
    isBreaking: record.isBreaking === true,
    isDeveloping: record.isDeveloping === true,
    importance: typeof record.importance === "number" ? record.importance : 0,
  };
}

function readFeedCache(
  persistence: PluginPersistence | undefined,
  feed: RssFeedConfig,
  options?: { allowExpired?: boolean; allowStale?: boolean },
): MarketNewsItem[] | null {
  const cached = persistence?.getResource<CachedFeedPayload>(RSS_CACHE_KIND, feed.id, {
    sourceKey: feed.url,
    allowExpired: options?.allowExpired,
  });
  if (cached?.stale && !options?.allowStale && !options?.allowExpired) return null;
  if (!cached?.value || !Array.isArray(cached.value.items)) return null;
  const items = cached.value.items
    .map(deserializeItem)
    .filter((item): item is MarketNewsItem => !!item);
  return items.length > 0 ? items : null;
}

function writeFeedCache(
  persistence: PluginPersistence | undefined,
  feed: RssFeedConfig,
  items: MarketNewsItem[],
): void {
  if (!persistence) return;
  persistence.setResource<CachedFeedPayload>(RSS_CACHE_KIND, feed.id, {
    items: items.map(serializeItem),
  }, {
    sourceKey: feed.url,
    cachePolicy: RSS_FEED_CACHE_POLICY,
    provenance: { url: feed.url, name: feed.name },
  });
}

export function createRssNewsCapability(
  feedsOrGetter: RssFeedConfig[] | (() => RssFeedConfig[]),
  options: RssNewsCapabilityOptions = {},
): NewsCapability {
  const fetchText = options.fetchText ?? ((url: string) => rssClient.fetch(url));
  const getFeeds = () => Array.isArray(feedsOrGetter) ? feedsOrGetter : feedsOrGetter();

  async function fetchFeed(feed: RssFeedConfig): Promise<{ items: MarketNewsItem[]; fromCache: boolean }> {
    const freshCache = readFeedCache(options.persistence, feed);
    if (freshCache) return { items: freshCache, fromCache: true };

    try {
      const items = await withConnectionRequest("rss", feed.name, async () => {
        const resp = await fetchText(feed.url);
        if (!resp.ok) throw new Error("RSS request failed");
        const xml = await resp.text();
        const knownTickers = options.tickerUniverse
          ? await options.tickerUniverse()
          : options.knownTickers
            ? buildArticleTickerUniverse({ book: [...await options.knownTickers()] })
            : undefined;
        const parsed = parseRssFeed(xml, feed)
          .map((item) => enrichNewsItem(item, feed.authority, knownTickers));
        writeFeedCache(options.persistence, feed, parsed);
        return parsed;
      });
      return { items, fromCache: false };
    } catch {
      const fallback = readFeedCache(options.persistence, feed, { allowExpired: true }) ?? [];
      return { items: fallback, fromCache: fallback.length > 0 };
    }
  }

  return newsProvider({
    id: "rss",
    name: "RSS Feeds",
    priority: 2000,
    provider: {
      supports: supportsQuery,
      getCachedNews(query: NewsQuery): MarketNewsItem[] {
        if (!supportsQuery(query)) return [];
        const enabledFeeds = getFeeds().filter((feed) => feed.enabled);
        return enabledFeeds.flatMap((feed) => readFeedCache(options.persistence, feed, { allowExpired: true }) ?? []);
      },
      async fetchNews(query: NewsQuery): Promise<MarketNewsItem[]> {
        if (!supportsQuery(query)) return [];
        const enabledFeeds = getFeeds().filter((f) => f.enabled);
        const results = await Promise.allSettled(
          enabledFeeds.map(fetchFeed),
        );

        const allItems: MarketNewsItem[] = [];
        let cacheOnlyHits = 0;
        let networkReports = 0;
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          allItems.push(...result.value.items);
          if (result.value.fromCache) cacheOnlyHits += 1;
          else networkReports += 1;
        }

        // When every feed is served from cache, no withConnectionRequest ran.
        // Emit one synthetic success so Connections reflects RSS as in use.
        if (networkReports === 0 && cacheOnlyHits > 0) {
          reportConnectionRequest("rss", {
            success: true,
            durationMs: 0,
            operation: `cache (${cacheOnlyHits} feeds)`,
          });
        }

        return allItems;
      },
    },
  });
}
