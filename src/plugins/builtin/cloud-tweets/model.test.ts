import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TWITTER_FEED_QUERY,
  DEFAULT_TWITTER_FEED_TITLE,
  TWEET_CELL_MAX_CHARS,
  buildTweetColumns,
  deriveFeedTitle,
  formatTweetCellText,
  namedTwitterFeedTitle,
  normalizeFeeds,
  parseTwitterFeedState,
  persistTwitterFeedState,
  resolvePersistedTwitterFeeds,
  resolveTwitterFeedQuery,
  tweetTextRowHeight,
} from "./model";

function feed(id: string, query: string) {
  return {
    id,
    title: deriveFeedTitle(query),
    query,
    queryType: "Latest" as const,
    createdAt: 1,
    updatedAt: 1,
    lastSuccessAt: null,
    lastError: null,
  };
}

describe("twitter feed defaults", () => {
  test("TWIT with no query opens the Markets list", () => {
    expect(resolveTwitterFeedQuery("")).toBe(DEFAULT_TWITTER_FEED_QUERY);
    expect(resolveTwitterFeedQuery("   ")).toBe(DEFAULT_TWITTER_FEED_QUERY);
    expect(resolveTwitterFeedQuery(undefined)).toBe(DEFAULT_TWITTER_FEED_QUERY);
    expect(resolveTwitterFeedQuery("from:Reuters")).toBe("from:Reuters");
  });

  test("names the default list tab Markets", () => {
    expect(namedTwitterFeedTitle(DEFAULT_TWITTER_FEED_QUERY)).toBe(DEFAULT_TWITTER_FEED_TITLE);
    expect(deriveFeedTitle(`  ${DEFAULT_TWITTER_FEED_QUERY}  `)).toBe("Markets");
    expect(deriveFeedTitle("from:Reuters")).not.toBe("Markets");
  });

  test("retitles a persisted Markets list even if the stored tab was the truncated id", () => {
    const feeds = normalizeFeeds({
      feeds: [{
        ...feed("1", DEFAULT_TWITTER_FEED_QUERY),
        title: "list:2090433878...",
      }],
    });
    expect(feeds[0]?.title).toBe("Markets");
  });
});

describe("twitter feed persistence", () => {
  test("parses a legacy feeds-only blob and persist fills the selected tab", () => {
    const markets = feed("markets", DEFAULT_TWITTER_FEED_QUERY);
    const parsed = parseTwitterFeedState({ feeds: [markets] });
    expect(parsed.activeFeedId).toBeNull();
    expect(persistTwitterFeedState(parsed).activeFeedId).toBe("markets");
  });

  test("drops an activeFeedId that is not in the tab list", () => {
    const persisted = persistTwitterFeedState({
      feeds: [feed("a", "from:Reuters"), feed("b", "from:Bloomberg")],
      activeFeedId: "missing",
    });
    expect(persisted.activeFeedId).toBe("a");
  });

  test("prefers pluginConfig tabs over pane-scoped resume state", () => {
    const resolved = resolvePersistedTwitterFeeds({
      config: {
        feeds: [feed("config", "from:Reuters")],
        activeFeedId: "config",
      },
      resume: {
        feeds: [feed("resume", "from:Bloomberg")],
        activeFeedId: "resume",
      },
    });
    expect(resolved.feeds.map((entry) => entry.id)).toEqual(["config"]);
    expect(resolved.activeFeedId).toBe("config");
  });

  test("restores resume tabs when pluginConfig has none yet", () => {
    const resolved = resolvePersistedTwitterFeeds({
      config: { feeds: [] },
      resume: {
        feeds: [feed("resume", "from:Bloomberg")],
        activeFeedId: "resume",
      },
    });
    expect(resolved.feeds.map((entry) => entry.id)).toEqual(["resume"]);
    expect(resolved.activeFeedId).toBe("resume");
  });

  test("keeps the pane-selected tab when the saved blob has no activeFeedId", () => {
    const resolved = resolvePersistedTwitterFeeds({
      config: {
        feeds: [feed("a", "from:Reuters"), feed("b", "from:Bloomberg")],
      },
      paneActiveFeedId: "b",
    });
    expect(resolved.activeFeedId).toBe("b");
  });
});

describe("tweet table layout", () => {
  test("gives the tweet column the leftover width and wraps to 240 characters", () => {
    const narrow = buildTweetColumns(94);
    const narrowText = narrow.find((column) => column.id === "text");
    const tickers = narrow.find((column) => column.id === "tickers");
    expect(narrowText?.width).toBeGreaterThan(tickers?.width ?? 0);
    expect(narrowText?.wrap).toBe(true);
    expect(narrowText?.flexGrow).toBe(1);

    const columns = buildTweetColumns(120);
    const text = columns.find((column) => column.id === "text");
    const rowHeight = tweetTextRowHeight(text?.width ?? 40);
    expect(rowHeight).toBeGreaterThanOrEqual(3);
    expect(rowHeight * (text?.width ?? 0)).toBeGreaterThanOrEqual(TWEET_CELL_MAX_CHARS);
  });

  test("keeps tweet cells to 240 characters", () => {
    const long = "x".repeat(300);
    expect(formatTweetCellText(long)).toHaveLength(TWEET_CELL_MAX_CHARS);
  });
});
