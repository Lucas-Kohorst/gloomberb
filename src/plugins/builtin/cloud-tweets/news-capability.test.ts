import { describe, expect, test } from "bun:test";
import type { CloudTweetPayload, CloudTweetSearchResponse } from "../../../api-client";
import { newsOriginLabel } from "../../../news/origins";
import {
  createXMarketsNewsCapability,
  normalizeXMarketsTweet,
  supportsXMarketsNewsQuery,
} from "./news-capability";
import { DEFAULT_TWITTER_FEED_QUERY, X_FEED_CONNECTION_ID } from "./model";

function makeTweet(overrides: Partial<CloudTweetPayload> = {}): CloudTweetPayload {
  return {
    id: "123",
    url: "https://x.com/marketsbot/status/123",
    text: "Markets rally on $NVDA earnings",
    createdAt: "2026-08-20T12:00:00.000Z",
    lang: "en",
    isReply: false,
    author: { id: "1", userName: "marketsbot", name: "Markets Bot" },
    metrics: {
      retweets: 0,
      replies: 0,
      likes: 0,
      quotes: 0,
      views: 0,
      bookmarks: 0,
    },
    ...overrides,
  };
}

function makeSearchResponse(tweets: CloudTweetPayload[]): CloudTweetSearchResponse {
  return {
    query: DEFAULT_TWITTER_FEED_QUERY,
    queryType: "Latest",
    since: "2026-08-20T06:00:00.000Z",
    until: "2026-08-20T12:00:00.000Z",
    limit: 50,
    hours: 6,
    cached: false,
    cacheTtlMs: 0,
    asOf: "2026-08-20T12:00:00.000Z",
    tweets,
  };
}

describe("normalizeXMarketsTweet", () => {
  test("maps tweet text, @source, tickers, body, and x: id", () => {
    const article = normalizeXMarketsTweet(makeTweet({
      media: [{ url: "https://pbs.twimg.com/media/photo.jpg" }],
    }));
    expect(article).not.toBeNull();
    expect(article?.id).toBe("x:123");
    expect(article?.title).toBe("Markets rally on $NVDA earnings");
    expect(article?.summary).toBe("Markets rally on $NVDA earnings");
    expect(article?.body).toBe("Markets rally on $NVDA earnings");
    expect(article?.source).toBe("@marketsbot");
    expect(article?.tickers).toEqual(["NVDA"]);
    expect(article?.url).toBe("https://x.com/marketsbot/status/123");
    expect(article?.imageUrl).toBe("https://pbs.twimg.com/media/photo.jpg");
    expect(article?.categories).toEqual(["twitter"]);
  });

  test("drops tweets without a url or with empty text", () => {
    expect(normalizeXMarketsTweet(makeTweet({ url: "" }))).toBeNull();
    expect(normalizeXMarketsTweet(makeTweet({ url: "   " }))).toBeNull();
    expect(normalizeXMarketsTweet(makeTweet({ text: "" }))).toBeNull();
    expect(normalizeXMarketsTweet(makeTweet({ text: "   " }))).toBeNull();
  });

  test("drops tweets with invalid dates", () => {
    expect(normalizeXMarketsTweet(makeTweet({ createdAt: "not-a-date" }))).toBeNull();
    expect(normalizeXMarketsTweet(makeTweet({ createdAt: "" }))).toBeNull();
  });
});

describe("supportsXMarketsNewsQuery", () => {
  test("supports latest and top, not ticker queries", () => {
    expect(supportsXMarketsNewsQuery({ feed: "latest" })).toBe(true);
    expect(supportsXMarketsNewsQuery({ feed: "top" })).toBe(true);
    expect(supportsXMarketsNewsQuery({})).toBe(true);
    expect(supportsXMarketsNewsQuery({ feed: "ticker", ticker: "NVDA" })).toBe(false);
    expect(supportsXMarketsNewsQuery({ scope: "ticker", ticker: "NVDA" })).toBe(false);
  });
});

describe("createXMarketsNewsCapability", () => {
  test("returns no articles when the session is unverified", async () => {
    const capability = createXMarketsNewsCapability({
      isVerified: () => false,
      search: async () => {
        throw new Error("search should not run while unverified");
      },
    });
    await expect(capability.provider.fetchNews({ feed: "latest" })).resolves.toEqual([]);
  });

  test("maps Markets search results when verified", async () => {
    const searched: string[] = [];
    const capability = createXMarketsNewsCapability({
      isVerified: () => true,
      search: async (query) => {
        searched.push(query);
        return makeSearchResponse([
          makeTweet(),
          makeTweet({ id: "missing-url", url: "" }),
          makeTweet({ id: "empty", text: "  " }),
        ]);
      },
    });

    const articles = await capability.provider.fetchNews({ feed: "latest" });
    expect(searched).toEqual([DEFAULT_TWITTER_FEED_QUERY]);
    expect(articles).toHaveLength(1);
    expect(articles[0]?.id).toBe("x:123");
    expect(articles[0]?.source).toBe("@marketsbot");
    expect(articles[0]?.tickers).toEqual(["NVDA"]);
    expect(articles[0]?.body).toBe("Markets rally on $NVDA earnings");
  });

  test("returns [] on auth errors and rethrows other failures", async () => {
    const unauthorized = createXMarketsNewsCapability({
      isVerified: () => true,
      search: async () => {
        throw new Error("Unauthorized: verification required");
      },
    });
    await expect(unauthorized.provider.fetchNews({ feed: "latest" })).resolves.toEqual([]);

    const failed = createXMarketsNewsCapability({
      isVerified: () => true,
      search: async () => {
        throw new Error("upstream timeout");
      },
    });
    await expect(failed.provider.fetchNews({ feed: "latest" })).rejects.toThrow("upstream timeout");
  });
});

describe("x-feed origin label", () => {
  test("labels the Markets news source as X", () => {
    expect(X_FEED_CONNECTION_ID).toBe("x-feed");
    expect(newsOriginLabel("x-feed")).toBe("X");
  });
});
