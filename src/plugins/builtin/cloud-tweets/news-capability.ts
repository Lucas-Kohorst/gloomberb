import { apiClient, type CloudTweetPayload, type CloudTweetSearchResponse } from "../../../api-client";
import { newsProvider, type NewsCapability } from "../../../capabilities";
import { normalizeNewsFeed } from "../../../news/news-model";
import type { NewsArticle, NewsQuery } from "../../../news/types";
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
const MAX_CACHED_TWEETS = 200;

const stories = new Map<string, NewsArticle>();

export interface XMarketsNewsCapabilityOptions {
  isVerified?: () => boolean;
  search?: (query: string) => Promise<CloudTweetSearchResponse>;
}

export function supportsXMarketsNewsQuery(query: NewsQuery): boolean {
  return normalizeNewsFeed(query) === "latest" && !query.cursor;
}

function rememberTweet(article: NewsArticle): NewsArticle {
  if (stories.has(article.id)) stories.delete(article.id);
  stories.set(article.id, article);
  while (stories.size > MAX_CACHED_TWEETS) {
    const oldest = stories.keys().next().value;
    if (oldest === undefined) break;
    stories.delete(oldest);
  }
  return article;
}

/**
 * A Markets-list tweet as a firehose row. The story item is the tweet itself,
 * so opening it does not ask Gloom Cloud for an `x:` id.
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
  const imageUrl = tweetImageUrls(tweet)[0];

  return rememberTweet({
    id: `x:${tweet.id}`,
    title: text,
    url,
    source,
    publishedAt,
    summary: text,
    imageUrl,
    topic: "general",
    topics: [],
    sectors: [],
    categories: ["twitter"],
    tickers: tweetTickers(tweet),
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
    items: [{
      id: tweet.id,
      sourceKey: X_FEED_CONNECTION_ID,
      sourceName: source,
      title: text,
      url,
      publishedAt,
    }],
  });
}

function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return AUTH_ERROR_RE.test(message);
}

export function createXMarketsNewsCapability(
  options: XMarketsNewsCapabilityOptions = {},
): NewsCapability {
  const isVerified = options.isVerified ?? (() => apiClient.isVerified());
  const search = options.search ?? ((query: string) => apiClient.searchCloudTweets({
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
          const limit = Math.min(query.limit ?? DEFAULT_TWEET_LIMIT, DEFAULT_TWEET_LIMIT);
          const articles: NewsArticle[] = [];
          for (const tweet of response.tweets) {
            const article = normalizeXMarketsTweet(tweet);
            if (!article) continue;
            articles.push(article);
            if (articles.length >= limit) break;
          }
          return articles;
        } catch (error) {
          if (isAuthError(error)) return [];
          throw error;
        }
      },
      fetchNewsStory(storyId: string): Promise<NewsArticle | null> {
        return Promise.resolve(stories.get(storyId) ?? null);
      },
    },
  });
}
