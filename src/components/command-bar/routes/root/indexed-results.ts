import { t } from "../../../../i18n";
import { PLUGIN_MARKETPLACE_TEMPLATE_ID } from "../../../../plugins/builtin/plugin-marketplace";
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
    right: "PLUGINS",
    shortcutQuery: "PLUGINS",
    searchText: "plugin marketplace build extend",
    action: () => {
      onOpenMarketplace();
    },
  };
}

export { PLUGIN_MARKETPLACE_TEMPLATE_ID };
