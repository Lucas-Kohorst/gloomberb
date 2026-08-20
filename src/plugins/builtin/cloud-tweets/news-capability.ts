import { apiClient, type CloudTweetPayload, type CloudTweetSearchResponse } from "../../../api-client";
import { newsProvider, type NewsCapability } from "../../../capabilities";
import type { NewsArticle, NewsQuery } from "../../../news/types";
import { searchXFeedTweets } from "./client";
import {
  DEFAULT_TWEET_HOURS,
  DEFAULT_TWEET_LIMIT,
  DEFAULT_TWITTER_FEED_QUERY,
  X_FEED_CONNECTION_ID,
  normalizeTweetDisplayText,
  tweetImageUrls,
  tweetTickers,
} from "./model";

const AUTH_ERROR_RE = /unauthorized|verification/i;

export interface XMarketsNewsCapabilityOptions {
  isVerified?: () => boolean;
  search?: (query: string) => Promise<CloudTweetSearchResponse>;
}

export function supportsXMarketsNewsQuery(query: NewsQuery): boolean {
  const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
  return feed === "latest" || feed === "top";
}

/**
 * Turns a Markets-list tweet into a firehose article so FH / ART can open the
 * tweet text without sending x.com through Jina.
 */
export function normalizeXMarketsTweet(tweet: CloudTweetPayload): NewsArticle | null {
  const url = tweet.url?.trim() || null;
  if (!url) return null;

  const publishedAt = tweet.createdAt ? new Date(tweet.createdAt) : null;
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;

  const text = normalizeTweetDisplayText(tweet.text).trim();
  if (!text) return null;

  const username = tweet.author.userName || tweet.author.name;
  const source = username ? `@${username}` : "X";
  const tickers = tweetTickers(tweet);
  const imageUrl = tweetImageUrls(tweet)[0];

  return {
    id: `x:${tweet.id}`,
    title: text,
    url,
    source,
    publishedAt,
    summary: text,
    body: text,
    imageUrl,
    topic: "general",
    topics: [],
    sectors: [],
    categories: ["twitter"],
    tickers,
    scores: {
      importance: 40,
      urgency: 0,
      marketImpact: 0,
      novelty: 0,
      confidence: 0,
    },
    isBreaking: false,
    isDeveloping: false,
    importance: 40,
  };
}

function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return AUTH_ERROR_RE.test(message);
}

export function createXMarketsNewsCapability(
  options: XMarketsNewsCapabilityOptions = {},
): NewsCapability {
  const isVerified = options.isVerified ?? (() => apiClient.isVerified());
  const search = options.search ?? ((query: string) => searchXFeedTweets({
    query,
    queryType: "Latest",
    hours: DEFAULT_TWEET_HOURS,
    limit: DEFAULT_TWEET_LIMIT,
  }));

  return newsProvider({
    id: X_FEED_CONNECTION_ID,
    name: "X",
    priority: 400,
    provider: {
      supports: supportsXMarketsNewsQuery,
      async fetchNews(query: NewsQuery): Promise<NewsArticle[]> {
        if (!supportsXMarketsNewsQuery(query)) return [];
        if (!isVerified()) return [];
        try {
          const response = await search(DEFAULT_TWITTER_FEED_QUERY);
          return response.tweets
            .map(normalizeXMarketsTweet)
            .filter((article): article is NewsArticle => article !== null);
        } catch (error) {
          if (isAuthError(error)) return [];
          throw error;
        }
      },
    },
  });
}
