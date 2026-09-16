import { t } from "../../../../i18n";
import { MARKETPLACE_TEMPLATE_ID } from "../../../../plugins/builtin/marketplace";
import {
  enabledNewsFeedNamesFromPluginConfig,
} from "../../../../plugins/builtin/news/wire/feed-config";
import {
  parseTwitterFeedState,
  TWITTER_FEED_PANE_ID,
  TWITTER_FEEDS_CONFIG_KEY,
  type TwitterFeed,
} from "../../../../plugins/builtin/cloud-tweets/model";
import type { PaneInstanceConfig } from "../../../../types/config";
import type { ResultItem } from "../../list/model";

const RELATED_PANE_LIMIT = 5;
const INDEX_MATCH_LIMIT = 6;

/** Prefixes that already own the rest of the query as command language. */
const CLAIMED_SEARCH_PREFIXES = new Set([
  "ART",
  "LAW",
  "ETF",
  "FH",
  "TWIT",
  "CAT",
  "SEC",
  "RSS",
  "SRCH",
  "DES",
  "CORR",
  "G",
]);

const TWITTER_OPERATOR_RE =
  /(?:^|\s)(?:from|to|since|until|filter|lang|list|url|min_faves|min_retweets|min_replies):/i;
const TWITTER_BARE_OPERATOR_RE = /\bmin_faves\b/i;
const TWITTER_OR_RE = /(?:^|\s)OR(?:\s|$)/;
const QUOTED_PHRASE_RE = /"[^"]+"/;
const HANDLE_OR_HASHTAG_RE = /(?:^|\s)[@#][A-Za-z0-9_]{1,50}/;

function claimedSearchPrefix(query: string): string | null {
  const match = query.trim().match(/^([A-Za-z]{1,8})(?:\s|$)/);
  if (!match) return null;
  const prefix = match[1]!.toUpperCase();
  return CLAIMED_SEARCH_PREFIXES.has(prefix) ? prefix : null;
}

/**
 * Free text that should open an X advanced-search feed: operators, @handle /
 * #hashtag, or a multi-word natural-language query. Single tickers and pane
 * prefixes (ART, LAW, ETF, FH, …) stay with their own command-bar rows.
 */
export function looksLikeTwitterSearchQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || claimedSearchPrefix(trimmed)) return false;
  if (TWITTER_OPERATOR_RE.test(trimmed) || TWITTER_BARE_OPERATOR_RE.test(trimmed)) return true;
  if (TWITTER_OR_RE.test(trimmed) && /\s/.test(trimmed)) return true;
  if (QUOTED_PHRASE_RE.test(trimmed)) return true;
  if (HANDLE_OR_HASHTAG_RE.test(trimmed)) return true;
  return trimmed.split(/\s+/).length >= 2;
}

export function buildTwitterSearchActionItem(options: {
  query: string;
  onOpen: (query: string) => void;
}): ResultItem | null {
  const query = options.query.trim();
  if (!looksLikeTwitterSearchQuery(query)) return null;
  return {
    id: `twitter-search:${query.toLowerCase()}`,
    label: query,
    detail: t("Open an X advanced-search feed"),
    category: "X Feeds",
    kind: "action",
    right: "TWIT",
    shortcutQuery: "TWIT",
    searchText: `${query} twitter x tweet feed search twit`,
    action: () => options.onOpen(query),
  };
}

function tokensOf(query: string, minLength = 2): string[] {
  return query.toLowerCase().split(/\s+/).filter((token) => token.length >= minLength);
}

function haystackOf(item: Pick<ResultItem, "label" | "detail" | "searchText" | "right">): string {
  return `${item.label} ${item.detail} ${item.searchText ?? ""} ${item.right ?? ""}`.toLowerCase();
}

function matchesAnyToken(haystack: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const words = haystack.split(/\s+/).filter(Boolean);
  return tokens.some((token) => (
    haystack.includes(token)
    || words.some((word) => word.startsWith(token) || token.startsWith(word) && word.length >= 3)
  ));
}

export function buildRssFeedResultItems(options: {
  pluginConfig: Record<string, Record<string, unknown>> | undefined;
  query: string;
  onOpen: (feedName: string) => void;
}): ResultItem[] {
  const query = options.query.trim();
  if (!query) return [];
  const names = enabledNewsFeedNamesFromPluginConfig(options.pluginConfig?.news);
  const tokens = tokensOf(query);
  return names
    .filter((name) => matchesAnyToken(name.toLowerCase(), tokens))
    .slice(0, INDEX_MATCH_LIMIT)
    .map((name) => ({
      id: `rss-feed:${name}`,
      label: name,
      detail: t("Open this RSS feed"),
      category: "RSS",
      kind: "action" as const,
      right: "RSS",
      shortcutQuery: "RSS",
      searchText: `${name} rss feed news`,
      action: () => options.onOpen(name),
    }));
}

export function twitterFeedsFromConfig(
  pluginConfig: Record<string, Record<string, unknown>> | undefined,
): TwitterFeed[] {
  return parseTwitterFeedState(pluginConfig?.["gloomberb-cloud"]?.[TWITTER_FEEDS_CONFIG_KEY]).feeds;
}

export function twitterFeedsFromOpenPanes(instances: readonly PaneInstanceConfig[]): TwitterFeed[] {
  return instances.flatMap((instance, index) => {
    if (instance.paneId !== TWITTER_FEED_PANE_ID) return [];
    const query = typeof instance.params?.query === "string" ? instance.params.query.trim() : "";
    const title = instance.title?.trim() || query;
    if (!query && !title) return [];
    return [{
      id: instance.instanceId || `open:${index}`,
      title: title || "X Feed",
      query: query || title,
      queryType: "Latest" as const,
      createdAt: 0,
      updatedAt: 0,
      lastSuccessAt: null,
      lastError: null,
    }];
  });
}

export function buildTwitterFeedResultItems(options: {
  feeds: readonly TwitterFeed[];
  query: string;
  onOpen: (feed: TwitterFeed) => void;
  onSearch?: (query: string) => void;
}): ResultItem[] {
  const query = options.query.trim();
  if (!query) return [];
  const tokens = tokensOf(query);
  const seen = new Set<string>();
  const items: ResultItem[] = [];
  for (const feed of options.feeds) {
    const title = feed.title.trim() || feed.query.trim();
    const haystack = `${title} ${feed.query} twitter x tweet feed`.toLowerCase();
    if (!matchesAnyToken(haystack, tokens)) continue;
    const key = feed.query.trim().toLowerCase() || title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `twitter-feed:${feed.id}`,
      label: title,
      detail: feed.query,
      category: "X Feeds",
      kind: "action",
      right: "TWIT",
      shortcutQuery: "TWIT",
      searchText: haystack,
      action: () => options.onOpen(feed),
    });
    if (items.length >= INDEX_MATCH_LIMIT) break;
  }
  if (!options.onSearch) return items;
  const searchItem = buildTwitterSearchActionItem({
    query,
    onOpen: options.onSearch,
  });
  if (!searchItem) return items;
  const normalized = query.toLowerCase();
  if (items.some((item) => item.detail.trim().toLowerCase() === normalized)) return items;
  items.push(searchItem);
  return items;
}

/** Panes that share a word with the query but did not survive strict fuzzy match. */
export function buildRelatedPaneItems(
  panes: readonly ResultItem[],
  query: string,
  alreadyShown: ReadonlySet<string>,
): ResultItem[] {
  const tokens = tokensOf(query, 3);
  if (tokens.length === 0) return [];
  return panes
    .filter((item) => !alreadyShown.has(item.id) && matchesAnyToken(haystackOf(item), tokens))
    .slice(0, RELATED_PANE_LIMIT)
    .map((item) => ({
      ...item,
      category: item.category || "Panes",
    }));
}

export function buildPluginFallbackItem(onOpenMarketplace: () => void): ResultItem {
  return {
    id: "plugin:build",
    label: t("Build a plugin"),
    detail: t("Nothing matched — open the marketplace to install or write one"),
    category: "Plugins",
    kind: "action",
    right: "PLUG",
    shortcutQuery: "PLUG",
    searchText: "plugin marketplace build extend",
    action: () => {
      onOpenMarketplace();
    },
  };
}

export { MARKETPLACE_TEMPLATE_ID };
