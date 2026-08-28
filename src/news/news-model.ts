import { canonicalExchange, normalizeSymbol } from "../utils/exchanges";
import type { NewsCapability } from "../capabilities";
import type { NewsArticle, NewsFeed, NewsQuery, NewsQueryState } from "./types";

export const MAX_ARTICLES = 10_000;
export const DEFAULT_GLOBAL_QUERY: NewsQuery = { feed: "latest", limit: MAX_ARTICLES };
export const TOP_NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;
const TOP_NEWS_EXCLUDED_ORIGINS = new Set(["rss", "x-feed", "substack-news", "substack"]);

const FEEDS = new Set<NewsFeed>(["latest", "top", "breaking", "ticker", "sector", "topic"]);
const DETAIL_CAPABLE_ARTICLE = Symbol("detail-capable-news-article");

type DetailCapableArticle = NewsArticle & { [DETAIL_CAPABLE_ARTICLE]?: true };

function normalizeTicker(ticker: string | undefined): string {
  return ticker ? normalizeSymbol(ticker) : "";
}

export function normalizeNewsCategory(category: string): string {
  return category.trim().toLowerCase();
}

export function formatNewsCategoryLabel(category: string): string {
  return category
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeNewsFeed(query: NewsQuery): NewsFeed {
  if (query.feed && FEEDS.has(query.feed)) return query.feed;
  return query.scope === "ticker" ? "ticker" : "latest";
}

function normalizeStringList(values: string[] | undefined): string[] | undefined {
  const normalized = [...new Set((values ?? []).map(normalizeNewsCategory).filter(Boolean))].sort();
  return normalized.length > 0 ? normalized : undefined;
}

export function buildNewsQueryKey(query: NewsQuery): string {
  const feed = normalizeNewsFeed(query);
  const ticker = normalizeTicker(query.ticker);
  const exchange = canonicalExchange(query.exchange);
  const topics = normalizeStringList(query.topics ?? query.categories) ?? [];
  const sectors = normalizeStringList(query.sectors) ?? [];
  const sources = normalizeStringList(query.sources) ?? [];
  const excludeSources = normalizeStringList(query.excludeSources) ?? [];
  const tickerRelations = normalizeStringList(query.tickerRelations) ?? [];
  return [
    feed,
    ticker,
    exchange,
    query.tickerTier ?? "",
    query.limit ?? MAX_ARTICLES,
    topics.join(","),
    sectors.join(","),
    sources.join(","),
    excludeSources.join(","),
    tickerRelations.join(","),
    query.sentiment ?? "",
    query.minImportance ?? "",
    query.minUrgency ?? "",
    query.breaking == null ? "" : String(query.breaking),
    query.since?.toISOString() ?? "",
    query.until?.toISOString() ?? "",
    query.cursor ?? "",
  ].join("|");
}

export function normalizeNewsQuery(query: NewsQuery): NewsQuery {
  const feed = normalizeNewsFeed(query);
  const topics = normalizeStringList(query.topics ?? query.categories);
  const sectors = normalizeStringList(query.sectors);
  return {
    ...query,
    feed,
    scope: feed === "ticker" ? "ticker" : "global",
    ticker: query.ticker ? normalizeTicker(query.ticker) : undefined,
    exchange: query.exchange ? canonicalExchange(query.exchange) : undefined,
    tickerTier: query.tickerTier ?? (feed === "ticker" ? "primary" : undefined),
    topics,
    categories: topics,
    sectors,
    sources: normalizeStringList(query.sources),
    excludeSources: normalizeStringList(query.excludeSources),
    tickerRelations: normalizeStringList(query.tickerRelations),
    limit: Math.max(1, Math.min(MAX_ARTICLES, query.limit ?? MAX_ARTICLES)),
  };
}

export function createIdleNewsQueryState(): NewsQueryState {
  return {
    phase: "idle",
    articles: [],
    error: null,
    updatedAt: null,
    sourceIds: [],
    nextCursor: null,
    loadingMore: false,
  };
}

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "reference",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "oly_enc_id",
  "oly_anon_id",
  "sr_share",
  "nb",
]);

/**
 * Canonicalises an article URL for cross-source deduplication.
 *
 * Strips tracking parameters, fragments, and trailing slashes so that the same
 * story republished by multiple aggregators collapses to one key. Falls back to
 * `null` when the URL is empty or invalid — callers should use a title+source
 * key or the item id in that case.
 */
export function canonicalArticleUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    const params = parsed.searchParams;
    for (const key of [...params.keys()]) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        params.delete(key);
      }
    }
    if ([...params].length === 0) parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    // Not a valid URL — fall back to a cleaned string key.
    const cleaned = trimmed.replace(/[#?].*$/, "").replace(/\/$/, "");
    return cleaned || null;
  }
}

/**
 * Normalises a title+source pair into a fallback dedup key for articles whose
 * URL is missing or non-canonical. Aggregators sometimes republish without a
 * unique link, so a title+source collapse catches those duplicates.
 */
export function titleSourceKey(title: string, source: string): string {
  const normalisedTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalisedSource = source.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalisedTitle ? `t:${normalisedSource}:${normalisedTitle}` : "";
}

function articleIdentityKeys(item: NewsArticle): string[] {
  const keys: string[] = [];
  const guid = item.guid?.trim().toLowerCase();
  if (guid) {
    keys.push(`g:${guid}`);
    const guidUrl = canonicalArticleUrl(guid);
    if (guidUrl) keys.push(`u:${guidUrl}`);
  }
  const url = canonicalArticleUrl(item.url);
  if (url) keys.push(`u:${url}`);
  if (keys.length === 0) {
    const titleKey = titleSourceKey(item.title, item.source);
    if (titleKey) keys.push(titleKey);
    else keys.push(`id:${item.id}`);
  }
  return keys;
}

function sortByPublishedAt(items: NewsArticle[]): NewsArticle[] {
  return [...items].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

function articleImportance(item: NewsArticle): number {
  return item.scores?.importance ?? item.importance ?? 0;
}

function sortTopNewsArticles(items: NewsArticle[]): NewsArticle[] {
  return [...items].sort((a, b) => {
    const scoreDelta = articleImportance(b) - articleImportance(a);
    if (scoreDelta !== 0) return scoreDelta;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
  });
}

function hasStoryItems(item: NewsArticle | null | undefined): boolean {
  return (item?.items?.length ?? 0) > 0;
}

function preferEarlierPublishedAt(left: Date, right: Date): Date {
  const leftMs = left.getTime();
  const rightMs = right.getTime();
  const leftOk = Number.isFinite(leftMs) && leftMs > 0;
  const rightOk = Number.isFinite(rightMs) && rightMs > 0;
  if (leftOk && rightOk) return leftMs <= rightMs ? left : right;
  return leftOk ? left : right;
}

export function markDetailCapableArticle(source: NewsCapability, item: NewsArticle): NewsArticle {
  if (!source.provider.fetchNewsStory) return item;
  Object.defineProperty(item, DETAIL_CAPABLE_ARTICLE, {
    value: true,
    configurable: true,
  });
  return item;
}

function isDetailCapableArticle(item: NewsArticle): boolean {
  return (item as DetailCapableArticle)[DETAIL_CAPABLE_ARTICLE] === true;
}

function shouldReplaceDuplicate(existing: NewsArticle, item: NewsArticle): boolean {
  return (
    item.importance > existing.importance ||
    (item.importance === existing.importance && item.publishedAt > existing.publishedAt)
  );
}

function selectDetailArticle(
  existing: NewsArticle,
  item: NewsArticle,
  winner: NewsArticle,
): NewsArticle | null {
  if (isDetailCapableArticle(winner)) return winner;
  if (isDetailCapableArticle(item)) return item;
  if (isDetailCapableArticle(existing)) return existing;
  if (hasStoryItems(winner)) return winner;
  if (hasStoryItems(item)) return item;
  if (hasStoryItems(existing)) return existing;
  return null;
}

function mergeDuplicateArticle(existing: NewsArticle, item: NewsArticle): NewsArticle {
  const winner = shouldReplaceDuplicate(existing, item)
    ? { ...existing, ...item }
    : existing;
  const publishedAt = preferEarlierPublishedAt(existing.publishedAt, item.publishedAt);
  const original = publishedAt === existing.publishedAt ? existing : item;
  const guid = existing.guid?.trim() || item.guid?.trim() || winner.guid;
  let merged: NewsArticle = {
    ...winner,
    id: original.id,
    guid,
    publishedAt,
  };
  const detailArticle = selectDetailArticle(existing, item, merged);
  if (detailArticle && detailArticle.id !== merged.id) {
    merged = {
      ...merged,
      id: detailArticle.id,
      items: hasStoryItems(detailArticle) ? detailArticle.items : merged.items,
    };
  }
  return merged;
}

interface ArticleCluster {
  article: NewsArticle;
  keys: Set<string>;
}

export function dedupeNewsArticles(items: NewsArticle[]): NewsArticle[] {
  const clusters: ArticleCluster[] = [];
  const keyToCluster = new Map<string, ArticleCluster>();

  for (const item of items) {
    const keys = articleIdentityKeys(item);
    const matched = new Set<ArticleCluster>();
    for (const key of keys) {
      const cluster = keyToCluster.get(key);
      if (cluster) matched.add(cluster);
    }

    if (matched.size === 0) {
      const cluster: ArticleCluster = { article: item, keys: new Set(keys) };
      clusters.push(cluster);
      for (const key of keys) keyToCluster.set(key, cluster);
      continue;
    }

    const [primary, ...rest] = [...matched];
    if (!primary) continue;
    primary.article = mergeDuplicateArticle(primary.article, item);
    for (const key of keys) {
      primary.keys.add(key);
      keyToCluster.set(key, primary);
    }
    for (const other of rest) {
      primary.article = mergeDuplicateArticle(primary.article, other.article);
      for (const key of other.keys) {
        primary.keys.add(key);
        keyToCluster.set(key, primary);
      }
      const index = clusters.indexOf(other);
      if (index >= 0) clusters.splice(index, 1);
    }
  }

  return sortByPublishedAt(clusters.map((cluster) => cluster.article)).slice(0, MAX_ARTICLES);
}

export function mergeNewsArticle(base: NewsArticle, detail: NewsArticle): NewsArticle {
  const detailItems = detail.items ?? [];
  const baseItems = base.items ?? [];
  return {
    ...base,
    ...detail,
    items: detailItems.length > 0 ? detailItems : baseItems,
  };
}

export function filterNewsArticlesForQuery(items: NewsArticle[], query: NewsQuery): NewsArticle[] {
  const feed = normalizeNewsFeed(query);
  let filtered = items;
  const sinceMs = feed === "top"
    ? Math.max(query.since?.getTime() ?? 0, Date.now() - TOP_NEWS_WINDOW_MS)
    : query.since?.getTime();
  if (sinceMs != null && sinceMs > 0) {
    filtered = filtered.filter((item) => item.publishedAt.getTime() > sinceMs);
  }
  if (feed === "top") {
    filtered = filtered.filter((item) => !item.origin || !TOP_NEWS_EXCLUDED_ORIGINS.has(item.origin));
  }
  const topics = query.topics ?? query.categories;
  if (topics && topics.length > 0) {
    const topicSet = new Set(topics.map(normalizeNewsCategory));
    filtered = filtered.filter((item) => (
      [item.topic, ...item.topics, ...item.categories].some((topic) => topicSet.has(normalizeNewsCategory(topic)))
    ));
  }
  if (query.sectors && query.sectors.length > 0) {
    const sectorSet = new Set(query.sectors.map(normalizeNewsCategory));
    filtered = filtered.filter((item) => (
      [...item.sectors, ...item.categories].some((sector) => sectorSet.has(normalizeNewsCategory(sector)))
    ));
  }
  if (query.sentiment) {
    filtered = filtered.filter((item) => item.sentiment === query.sentiment);
  }
  if (query.minImportance != null) {
    filtered = filtered.filter((item) => item.scores.importance >= query.minImportance!);
  }
  if (query.minUrgency != null) {
    filtered = filtered.filter((item) => item.scores.urgency >= query.minUrgency!);
  }
  if (query.breaking != null) {
    filtered = filtered.filter((item) => item.isBreaking === query.breaking);
  }
  if (feed === "top") {
    return sortTopNewsArticles(filtered).slice(0, MAX_ARTICLES);
  }
  return filtered.slice(0, MAX_ARTICLES);
}
