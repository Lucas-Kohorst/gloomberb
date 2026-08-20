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
  resolveTwitterFeedQuery,
  tweetTextRowHeight,
} from "./model";

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
        id: "1",
        title: "list:2090433878...",
        query: DEFAULT_TWITTER_FEED_QUERY,
        queryType: "Latest",
        createdAt: 1,
        updatedAt: 1,
        lastSuccessAt: null,
        lastError: null,
      }],
    });
    expect(feeds[0]?.title).toBe("Markets");
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
