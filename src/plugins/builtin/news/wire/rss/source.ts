import { createThrottledFetch } from "../../../../../utils/throttled-fetch";
import { newsProvider, type NewsCapability } from "../../../../../capabilities";
import type { NewsQuery, MarketNewsItem } from "../../../../../types/news-source";
import type { PluginPersistence } from "../../../../../types/plugin";
import { parseRssFeed, type RssFeedConfig } from "./parser";
import { enrichNewsItem } from "../categories";
import { withConnectionRequest, reportConnectionRequest } from "../../../connections/register";
import { dedupeNewsArticles } from "../../../../../news/news-model";
import { newsPollIntervalMsFromMinutes } from "../../../../../news/poll-interval";
import { getSharedRegistry } from "../../../../registry";
import {
  buildArticleTickerUniverse,
  type ArticleTickerUniverse,
} from "../../../../../news/article-tickers";

const RSS_CACHE_KIND = "rss-feed";
const RSS_CACHE_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RSS_CACHE_STALE_MS = 15 * 60 * 1000;

export function rssFeedCachePolicy(staleMs = currentRssCacheStaleMs()): {
  staleMs: number;
  expireMs: number;
} {
  return {
    staleMs,
    expireMs: RSS_CACHE_EXPIRE_MS,
  };
}

export function currentRssCacheStaleMs(): number {
  try {
    const minutes = getSharedRegistry()?.getConfigFn?.().refreshIntervalMinutes;
    if (typeof minutes === "number" && minutes >= 1) {
      return newsPollIntervalMsFromMinutes(minutes);
    }
  } catch {
    // Tests and early startup have no live registry config.
  }
  return DEFAULT_RSS_CACHE_STALE_MS;
}

export const RSS_FEED_CACHE_POLICY = rssFeedCachePolicy(DEFAULT_RSS_CACHE_STALE_MS);

interface CachedNewsItem extends Omit<MarketNewsItem, "publishedAt"> {
  publishedAt: string;
}

interface CachedFeedPayload {
  items: CachedNewsItem[];
}

export const RSS_FETCH_CONCURRENCY = 6;
/** Seed/getCachedNews stop after this many items so Firehose can paint. */
export const RSS_CACHED_HEAD_LIMIT = 400;
const RSS_PARTIAL_HEAD = 200;
const RSS_PARTIAL_MIN_INTERVAL_MS = 400;
const RSS_CACHE_YIELD_EVERY = 8;

function rankEnabledFeeds(feeds: readonly RssFeedConfig[]): RssFeedConfig[] {
  return feeds
    .filter((feed) => feed.enabled)
    .slice()
    .sort((left, right) => right.authority - left.authority || left.name.localeCompare(right.name));
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const rssClient = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 1,
  timeoutMs: 10_000,
  maxConcurrent: RSS_FETCH_CONCURRENCY,
  defaultHeaders: {
    "User-Agent": "Gloomberb/0.4.1",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  },
});

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export interface RssNewsCapabilityOptions {
  /** Resolved at fetch time so newly added tickers are matched without a restart. */
  knownTickers?: () => Promise<Set<string>>;
  tickerUniverse?: () => Promise<ArticleTickerUniverse>;
  persistence?: PluginPersistence;
  fetchText?: (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;
}

function supportsQuery(query: NewsQuery): boolean {
  const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
  return feed === "latest";
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
    guid: typeof record.guid === "string" && record.guid.trim() ? record.guid : undefined,
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
    cachePolicy: rssFeedCachePolicy(),
    provenance: { url: feed.url, name: feed.name },
  });
}

export function createRssNewsCapability(
  feedsOrGetter: RssFeedConfig[] | (() => RssFeedConfig[]),
  options: RssNewsCapabilityOptions = {},
): NewsCapability {
  const fetchText = options.fetchText ?? ((url: string) => rssClient.fetch(url));
  const getFeeds = () => Array.isArray(feedsOrGetter) ? feedsOrGetter : feedsOrGetter();

  async function fetchFeed(
    feed: RssFeedConfig,
    resolveUniverse: () => Promise<ArticleTickerUniverse | undefined>,
  ): Promise<{ items: MarketNewsItem[]; fromCache: boolean }> {
    const freshCache = readFeedCache(options.persistence, feed);
    if (freshCache) return { items: freshCache, fromCache: true };

    try {
      const items = await withConnectionRequest("rss", feed.name, async () => {
        const resp = await fetchText(feed.url);
        if (!resp.ok) throw new Error("RSS request failed");
        const xml = await resp.text();
        const knownTickers = await resolveUniverse();
        const parsed = parseRssFeed(xml, feed)
          .map((item) => enrichNewsItem(item, feed.authority, knownTickers));
        writeFeedCache(options.persistence, feed, parsed);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
        const limit = Math.min(query.limit ?? RSS_CACHED_HEAD_LIMIT, RSS_CACHED_HEAD_LIMIT);
        const collected: MarketNewsItem[] = [];
        for (const feed of rankEnabledFeeds(getFeeds())) {
          const cached = readFeedCache(options.persistence, feed, { allowExpired: true }) ?? [];
          if (cached.length === 0) continue;
          collected.push(...cached);
          if (collected.length >= limit) break;
        }
        return collected.length === 0
          ? []
          : dedupeNewsArticles(collected).slice(0, limit);
      },
      async fetchNews(query: NewsQuery, fetchOptions?: { onPartial?: (articles: MarketNewsItem[]) => void }): Promise<MarketNewsItem[]> {
        if (!supportsQuery(query)) return [];
        const enabledFeeds = rankEnabledFeeds(getFeeds());
        let universePromise: Promise<ArticleTickerUniverse | undefined> | null = null;
        const resolveUniverse = () => {
          if (universePromise) return universePromise;
          if (options.tickerUniverse) {
            universePromise = options.tickerUniverse();
          } else if (options.knownTickers) {
            universePromise = options.knownTickers().then((tickers) => (
              buildArticleTickerUniverse({ book: [...tickers] })
            ));
          } else {
            universePromise = Promise.resolve(undefined);
          }
          return universePromise;
        };
        const collected: MarketNewsItem[] = [];
        let cacheOnlyHits = 0;
        let networkReports = 0;
        let partialTimer: ReturnType<typeof setTimeout> | null = null;
        let lastPartialAt = 0;
        const flushPartial = () => {
          partialTimer = null;
          lastPartialAt = Date.now();
          fetchOptions?.onPartial?.(collected.slice());
        };
        const emitPartial = (force = false) => {
          if (!fetchOptions?.onPartial || collected.length === 0) return;
          if (partialTimer !== null) {
            if (!force) return;
            clearTimeout(partialTimer);
            partialTimer = null;
          }
          if (force || lastPartialAt === 0) {
            flushPartial();
            return;
          }
          const wait = Math.max(0, RSS_PARTIAL_MIN_INTERVAL_MS - (Date.now() - lastPartialAt));
          partialTimer = setTimeout(flushPartial, wait);
        };

        const pending: RssFeedConfig[] = [];
        let sinceYield = 0;
        let emittedHead = false;
        for (const feed of enabledFeeds) {
          const fresh = readFeedCache(options.persistence, feed);
          if (!fresh) {
            pending.push(feed);
            continue;
          }
          collected.push(...fresh);
          cacheOnlyHits += 1;
          if (!emittedHead && collected.length >= RSS_PARTIAL_HEAD) {
            emitPartial(true);
            emittedHead = true;
            await yieldToUi();
            sinceYield = 0;
            continue;
          }
          sinceYield += 1;
          if (sinceYield >= RSS_CACHE_YIELD_EVERY) {
            sinceYield = 0;
            await yieldToUi();
          }
        }
        if (collected.length > 0) emitPartial(!emittedHead);

        try {
          await mapPool(pending, RSS_FETCH_CONCURRENCY, async (feed) => {
            const result = await fetchFeed(feed, resolveUniverse);
            collected.push(...result.items);
            if (result.fromCache) cacheOnlyHits += 1;
            else networkReports += 1;
            emitPartial();
            return result;
          });
        } finally {
          if (partialTimer !== null) {
            clearTimeout(partialTimer);
            partialTimer = null;
          }
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

        return dedupeNewsArticles(collected);
      },
    },
  });
}
