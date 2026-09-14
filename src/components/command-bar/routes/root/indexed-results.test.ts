import { describe, expect, test } from "bun:test";
import type { ResultItem } from "../../list/model";
import {
  buildRelatedPaneItems,
  buildRssFeedResultItems,
  buildTwitterFeedResultItems,
  looksLikeTwitterSearchQuery,
  twitterFeedsFromOpenPanes,
} from "./indexed-results";
import { TWITTER_FEED_PANE_ID } from "../../../../plugins/builtin/cloud-tweets/model";

function pane(id: string, label: string, searchText: string): ResultItem {
  return {
    id,
    label,
    detail: "",
    category: "Panes",
    kind: "action",
    searchText,
    action: () => {},
  };
}

describe("indexed command-bar results", () => {
  test("lists enabled RSS feeds whose names match the query", () => {
    const opened: string[] = [];
    const items = buildRssFeedResultItems({
      pluginConfig: { news: {} },
      query: "cnbc",
      onOpen: (name) => {
        opened.push(name);
      },
    });
    expect(items.map((item) => item.label)).toContain("CNBC Top News");
    items[0]?.action();
    expect(opened).toEqual(["CNBC Top News"]);
  });

  test("lists saved and open X feeds", () => {
    const opened: string[] = [];
    const items = buildTwitterFeedResultItems({
      feeds: [
        {
          id: "markets",
          title: "Markets",
          query: "list:2090433878028685747",
          queryType: "Latest",
          createdAt: 0,
          updatedAt: 0,
          lastSuccessAt: null,
          lastError: null,
        },
        {
          id: "nfl",
          title: "Kalshi nfl",
          query: "kalshi nfl",
          queryType: "Latest",
          createdAt: 0,
          updatedAt: 0,
          lastSuccessAt: null,
          lastError: null,
        },
      ],
      query: "nfl",
      onOpen: (feed) => {
        opened.push(feed.title);
      },
    });
    expect(items.map((item) => item.label)).toEqual(["Kalshi nfl"]);
    items[0]?.action();
    expect(opened).toEqual(["Kalshi nfl"]);

    expect(twitterFeedsFromOpenPanes([
      { instanceId: "x1", paneId: TWITTER_FEED_PANE_ID, title: "Kalshi nfl", params: { query: "kalshi nfl" } },
    ]).map((feed) => feed.title)).toEqual(["Kalshi nfl"]);
  });

  test("classifies X/Google search text without stealing tickers or pane prefixes", () => {
    expect(looksLikeTwitterSearchQuery("from:elonmusk")).toBe(true);
    expect(looksLikeTwitterSearchQuery("to:Reuters since:2024-01-01")).toBe(true);
    expect(looksLikeTwitterSearchQuery("nvda OR amd filter:verified")).toBe(true);
    expect(looksLikeTwitterSearchQuery("min_faves:100")).toBe(true);
    expect(looksLikeTwitterSearchQuery('"why did nvda dump"')).toBe(true);
    expect(looksLikeTwitterSearchQuery("@elonmusk")).toBe(true);
    expect(looksLikeTwitterSearchQuery("#bitcoin")).toBe(true);
    expect(looksLikeTwitterSearchQuery("why did nvda dump")).toBe(true);

    expect(looksLikeTwitterSearchQuery("AAPL")).toBe(false);
    expect(looksLikeTwitterSearchQuery("nvidia")).toBe(false);
    expect(looksLikeTwitterSearchQuery("ART hormuz")).toBe(false);
    expect(looksLikeTwitterSearchQuery("LAW kalshi")).toBe(false);
    expect(looksLikeTwitterSearchQuery("ETF SPY")).toBe(false);
    expect(looksLikeTwitterSearchQuery("FH")).toBe(false);
    expect(looksLikeTwitterSearchQuery("TWIT from:elonmusk")).toBe(false);
  });

  test("offers Search X when no saved feed matches", () => {
    const opened: string[] = [];
    const items = buildTwitterFeedResultItems({
      feeds: [],
      query: "from:elonmusk min_faves:50",
      onOpen: () => {},
      onSearch: (query) => {
        opened.push(query);
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("from:elonmusk min_faves:50");
    expect(items[0]?.right).toBe("TWIT");
    items[0]?.action();
    expect(opened).toEqual(["from:elonmusk min_faves:50"]);

    const unmatched = buildTwitterFeedResultItems({
      feeds: [],
      query: "why did nvda dump",
      onOpen: () => {},
      onSearch: () => {},
    });
    expect(unmatched.map((item) => item.right)).toEqual(["TWIT"]);
  });

  test("offers related panes that share a word with the query", () => {
    const weather = pane("weather-pane", "Weather", "weather climate temperature temp nws");
    const options = pane("options-calculator", "Options Calculator", "options greeks implied volatility");
    const related = buildRelatedPaneItems(
      [weather, options],
      "alanta temp",
      new Set(),
    );
    expect(related.map((item) => item.label)).toEqual(["Weather"]);
  });
});
