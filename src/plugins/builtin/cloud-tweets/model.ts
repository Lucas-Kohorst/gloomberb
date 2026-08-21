import type { DataTableColumn } from "../../../components";
import type {
  CloudTweetPayload,
  CloudTweetQueryType,
  CloudTweetSearchResponse,
} from "../../../api-client";
import { formatCompact, formatTimeAgo } from "../../../utils/format";
import { normalizeTweetText } from "../../../utils/tweet-text";
import { truncateWithEllipsis } from "../../../utils/text-wrap";
import { toTimestampMillis } from "../../../utils/timestamp";
import { collectUniqueTickerSymbols } from "../../../tickers/tokenizer";
import { extractArticleTickersFromParts } from "../../../news/article-tickers";
import { normalizedHttpUrl } from "../../../utils/url";
import {
  resolveVisibleColumns,
  type ColumnVisibilityColumn,
} from "../../../components/data-table/column-settings";

export const DEFAULT_TWEET_HOURS = 6;
export const DEFAULT_TWEET_LIMIT = 50;
export const TWEET_SEARCH_SCHEMA_VERSION = 1;
export const TWEET_SEARCH_DEBOUNCE_MS = 450;
export const TWITTER_FEED_PANE_ID = "twitter-feed";
export const TWITTER_FEEDS_CONFIG_KEY = "twitterFeeds";
export const TWITTER_FEED_LAUNCH_STATE_KEY = "twitter-feed-launch";
export const TWITTER_FEED_LAUNCH_SCHEMA_VERSION = 1;
export const DEFAULT_TWITTER_FEED_QUERY = "list:2090433878028685747";
export const DEFAULT_TWITTER_FEED_TITLE = "Markets";
export const X_FEED_CONNECTION_ID = "x-feed";
export const TWEET_CELL_MAX_CHARS = 240;
export const TWEET_ROW_MAX_LINES = 8;

const TWITTER_USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

export type TweetColumnId = "time" | "author" | "text" | "tickers" | "likes" | "views";
export type TweetColumn = DataTableColumn & { id: TweetColumnId };
export type TweetSortColumnId = "time" | "likes" | "views";
export type TweetSortDirection = "asc" | "desc";
export type TweetDensity = "comfortable" | "compact";
export const TWEET_SORT_COLUMN_IDS: readonly TweetSortColumnId[] = ["time", "likes", "views"];
export const TWEET_COLUMN_DEFS: readonly ColumnVisibilityColumn[] = [
  { id: "time", label: "TIME", description: "When the post was published." },
  { id: "author", label: "AUTHOR", description: "Account that posted." },
  { id: "text", label: "TWEET", description: "Post text. Always kept visible." },
  { id: "tickers", label: "TICKERS", description: "Mentioned symbols." },
  { id: "likes", label: "LIKES", description: "Like count." },
  { id: "views", label: "VIEWS", description: "View count." },
];
const TWEET_COLUMN_LAYOUT: Record<TweetColumnId, { width: number; align: "left" | "right"; wrap?: boolean; flex?: boolean }> = {
  time: { width: 7, align: "left" },
  author: { width: 16, align: "left" },
  text: { width: 32, align: "left", wrap: true, flex: true },
  tickers: { width: 12, align: "left" },
  likes: { width: 7, align: "right" },
  views: { width: 8, align: "right" },
};

export const DEFAULT_TWEET_SORT: { columnId: TweetSortColumnId; direction: TweetSortDirection } = {
  columnId: "time",
  direction: "desc",
};

export interface TweetLoadState {
  data: CloudTweetSearchResponse | null;
  loading: boolean;
  error: string | null;
}

export interface TwitterFeed {
  id: string;
  title: string;
  query: string;
  queryType: CloudTweetQueryType;
  createdAt: number;
  updatedAt: number;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export interface PersistedTwitterFeedState {
  feeds: TwitterFeed[];
  activeFeedId?: string | null;
}

export interface TwitterFeedLaunchRequest {
  query: string;
  targetPaneId: string | null;
  nonce: string;
  createdAt: number;
  queryType?: CloudTweetQueryType;
}

export const EMPTY_FEED_STATE: PersistedTwitterFeedState = { feeds: [], activeFeedId: null };

export function twitterFeedResumeStateKey(paneId: string): string {
  return `twitter-feed:${paneId}`;
}

let nextTwitterFeedId = 1;

function generateFeedId(): string {
  return `${Date.now()}-${nextTwitterFeedId++}`;
}

export function resolveTwitterFeedQuery(query: string | null | undefined): string {
  const trimmed = typeof query === "string" ? query.trim() : "";
  return trimmed || DEFAULT_TWITTER_FEED_QUERY;
}

export function namedTwitterFeedTitle(query: string): string | null {
  return normalizeFeedQuery(query) === normalizeFeedQuery(DEFAULT_TWITTER_FEED_QUERY)
    ? DEFAULT_TWITTER_FEED_TITLE
    : null;
}

export function deriveFeedTitle(query: string): string {
  const named = namedTwitterFeedTitle(query);
  if (named) return named;
  const tickers = collectUniqueTickerSymbols([query]);
  if (tickers.length > 0) return tickers.slice(0, 3).map((ticker) => `$${ticker}`).join(" ");
  return truncateWithEllipsis(query.replace(/\s+/g, " ").trim(), 24) || "New";
}

export function createFeed(query: string, queryType: CloudTweetQueryType): TwitterFeed {
  const now = Date.now();
  return {
    id: generateFeedId(),
    title: deriveFeedTitle(query),
    query,
    queryType,
    createdAt: now,
    updatedAt: now,
    lastSuccessAt: null,
    lastError: null,
  };
}

export function normalizeFeedQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeTwitterUsername(username: string): string | null {
  const normalized = username.trim().replace(/^@/, "");
  return TWITTER_USERNAME_RE.test(normalized) ? normalized : null;
}

export function twitterUserSearchQuery(username: string): string {
  return `from:${username}`;
}

export function normalizeFeeds(value: unknown): TwitterFeed[] {
  const entries = Array.isArray((value as PersistedTwitterFeedState | undefined)?.feeds)
    ? (value as PersistedTwitterFeedState).feeds
    : [];
  return entries
    .filter((entry): entry is TwitterFeed => (
      !!entry
      && typeof entry === "object"
      && typeof entry.id === "string"
      && typeof entry.query === "string"
    ))
    .map((entry) => ({
      ...entry,
      title: namedTwitterFeedTitle(entry.query)
        ?? (typeof entry.title === "string" && entry.title.trim() ? entry.title : deriveFeedTitle(entry.query)),
      queryType: entry.queryType === "Top" ? "Top" : "Latest",
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
      lastSuccessAt: typeof entry.lastSuccessAt === "number" ? entry.lastSuccessAt : null,
      lastError: typeof entry.lastError === "string" ? entry.lastError : null,
    }));
}

function resolvedActiveFeedId(feeds: TwitterFeed[], candidate: unknown): string | null {
  return typeof candidate === "string" && feeds.some((feed) => feed.id === candidate)
    ? candidate
    : null;
}

export function parseTwitterFeedState(value: unknown): PersistedTwitterFeedState {
  const feeds = normalizeFeeds(value);
  const rawActive = value && typeof value === "object"
    ? (value as PersistedTwitterFeedState).activeFeedId
    : null;
  return {
    feeds,
    activeFeedId: resolvedActiveFeedId(feeds, rawActive),
  };
}

export function persistTwitterFeedState(state: PersistedTwitterFeedState): PersistedTwitterFeedState {
  const feeds = normalizeFeeds(state);
  return {
    feeds,
    activeFeedId: resolvedActiveFeedId(feeds, state.activeFeedId) ?? feeds[0]?.id ?? null,
  };
}

export function resolvePersistedTwitterFeeds(options: {
  config: unknown;
  resume?: unknown;
  paneActiveFeedId?: string | null;
}): PersistedTwitterFeedState {
  const fromConfig = parseTwitterFeedState(options.config);
  const parsed = fromConfig.feeds.length > 0 ? fromConfig : parseTwitterFeedState(options.resume);
  const paneActiveFeedId = resolvedActiveFeedId(parsed.feeds, options.paneActiveFeedId);
  return persistTwitterFeedState({
    feeds: parsed.feeds,
    activeFeedId: parsed.activeFeedId ?? paneActiveFeedId,
  });
}

export function formatRelativeShort(value: string): string {
  return formatTimeAgo(value).replace(" ago", "").replace("just now", "<1m");
}

export function formatMetric(value: number | null | undefined): string {
  if (value == null) return "-";
  if (Math.abs(value) >= 1000) return formatCompact(value);
  return String(value);
}

export function normalizeTweetDisplayText(value: string): string {
  return normalizeTweetText(value, { preserveLineBreaks: true });
}

export function normalizeTweetCellText(value: string): string {
  return normalizeTweetText(value);
}

export function formatTweetCellText(value: string): string {
  const normalized = normalizeTweetCellText(value);
  return normalized.length <= TWEET_CELL_MAX_CHARS
    ? normalized
    : normalized.slice(0, TWEET_CELL_MAX_CHARS);
}

export function tweetTextRowHeight(textWidth: number, density: TweetDensity = "comfortable"): number {
  if (density === "compact") return 1;
  const width = Math.max(1, Math.floor(textWidth));
  return Math.min(
    TWEET_ROW_MAX_LINES,
    Math.max(3, Math.ceil(TWEET_CELL_MAX_CHARS / width)),
  );
}

function nestedTweetText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = normalizeTweetDisplayText(value).trim();
    return text || null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = record.text ?? record.fullText ?? record.full_text ?? record.noteTweet;
  if (typeof text === "string") {
    const normalized = normalizeTweetDisplayText(text).trim();
    return normalized || null;
  }
  if (text && typeof text === "object") {
    const nested = (text as Record<string, unknown>).text;
    if (typeof nested === "string") {
      const normalized = normalizeTweetDisplayText(nested).trim();
      return normalized || null;
    }
  }
  return null;
}

/** Tweet body plus any quoted/retweeted text the payload still carries. */
export function tweetTickerTexts(tweet: CloudTweetPayload): string[] {
  const record = tweet as unknown as Record<string, unknown>;
  const texts: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    texts.push(value);
  };

  push(normalizeTweetDisplayText(tweet.text).trim() || null);
  for (const key of [
    "quotedTweet",
    "quoted_tweet",
    "quoted_status",
    "retweetedTweet",
    "retweeted_tweet",
    "retweetedStatus",
    "retweeted_status",
    "legacyQuotedTweet",
  ]) {
    push(nestedTweetText(record[key]));
  }
  return texts;
}

export function tweetTickers(tweet: CloudTweetPayload): string[] {
  return extractArticleTickersFromParts(tweetTickerTexts(tweet));
}

function tweetCreatedAtMs(tweet: CloudTweetPayload): number {
  const ms = toTimestampMillis(tweet.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function compareNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  sortDirection: TweetSortDirection,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const comparison = left - right;
  return sortDirection === "asc" ? comparison : -comparison;
}

export function isTweetSortColumnId(columnId: string): columnId is TweetSortColumnId {
  return columnId === "time" || columnId === "likes" || columnId === "views";
}

function compareTweets(
  left: CloudTweetPayload,
  right: CloudTweetPayload,
  sortColumnId: TweetSortColumnId,
  sortDirection: TweetSortDirection,
): number {
  let comparison = 0;
  switch (sortColumnId) {
    case "time":
      comparison = tweetCreatedAtMs(left) - tweetCreatedAtMs(right);
      if (comparison !== 0) {
        return sortDirection === "asc" ? comparison : -comparison;
      }
      break;
    case "likes":
      comparison = compareNullableNumber(left.metrics.likes, right.metrics.likes, sortDirection);
      break;
    case "views":
      comparison = compareNullableNumber(left.metrics.views, right.metrics.views, sortDirection);
      break;
  }

  if (comparison !== 0) return comparison;

  return tweetCreatedAtMs(right) - tweetCreatedAtMs(left);
}

export function sortedTweets(
  tweets: CloudTweetPayload[],
  sortColumnId: TweetSortColumnId,
  sortDirection: TweetSortDirection,
): CloudTweetPayload[] {
  return [...tweets].sort((left, right) => compareTweets(left, right, sortColumnId, sortDirection));
}

function mediaImageUrl(value: unknown): string | null {
  const directUrl = normalizedHttpUrl(value);
  if (directUrl) return directUrl;
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  return normalizedHttpUrl(record.mediaUrl)
    ?? normalizedHttpUrl(record.media_url_https)
    ?? normalizedHttpUrl(record.media_url)
    ?? normalizedHttpUrl(record.previewImageUrl)
    ?? normalizedHttpUrl(record.preview_image_url)
    ?? normalizedHttpUrl(record.url);
}

function nestedMedia(record: Record<string, unknown>, key: string): unknown {
  const value = record[key];
  return value && typeof value === "object" ? (value as Record<string, unknown>).media : undefined;
}

export function tweetImageUrls(tweet: CloudTweetPayload): string[] {
  const record = tweet as unknown as Record<string, unknown>;
  const candidates = [
    record.media,
    record.photos,
    record.images,
    nestedMedia(record, "entities"),
    nestedMedia(record, "extendedEntities"),
    nestedMedia(record, "extended_entities"),
  ];
  const urls = new Set<string>();
  for (const candidate of candidates) {
    const entries = Array.isArray(candidate) ? candidate : candidate == null ? [] : [candidate];
    for (const entry of entries) {
      const url = mediaImageUrl(entry);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

export function buildTweetColumns(width: number, columnIds?: unknown): TweetColumn[] {
  const visible = resolveVisibleColumns(
    TWEET_COLUMN_DEFS,
    columnIds,
    TWEET_COLUMN_DEFS.map((column) => column.id),
  );
  const ids = visible.map((column) => column.id as TweetColumnId);
  const resolvedIds = ids.includes("text") ? ids : [...ids, "text" as const];
  const flexId = resolvedIds.includes("text") ? "text" : resolvedIds[0];
  const fixedWidth = resolvedIds
    .filter((id) => id !== flexId)
    .reduce((sum, id) => sum + TWEET_COLUMN_LAYOUT[id]!.width, 0);
  const flexWidth = Math.max(
    TWEET_COLUMN_LAYOUT[flexId ?? "text"]?.width ?? 32,
    width - fixedWidth - resolvedIds.length - 3,
  );
  return resolvedIds.map((id) => {
    const layout = TWEET_COLUMN_LAYOUT[id]!;
    const def = TWEET_COLUMN_DEFS.find((column) => column.id === id);
    return {
      id,
      label: def?.label ?? id.toUpperCase(),
      width: id === flexId ? flexWidth : layout.width,
      align: layout.align,
      flexGrow: id === flexId ? 1 : undefined,
      wrap: layout.wrap,
    };
  });
}
