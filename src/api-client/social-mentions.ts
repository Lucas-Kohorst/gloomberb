import { apiClient } from "./index";

export type SocialMentionsRange = "1y" | "5y" | "max";

interface SocialMentionDay {
  /** UTC day. */
  day: string;
  mentions: number;
  /** False while the day is still being counted. */
  closed: boolean;
}

export interface SocialMentionPost {
  id: string;
  day: string;
  author: string;
  text: string;
  postedAt: string;
  /** Null before X showed view counts (2022-12-22). */
  views: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  url: string;
  /** Jev bullish minus bearish probability, -1..1. */
  stance: number | null;
}

export interface SocialMentionsPayload {
  symbol: string;
  range: SocialMentionsRange;
  asOf: string;
  x: {
    days: SocialMentionDay[];
    historyFrom: string | null;
    completeThrough: string | null;
    /** Median posts per closed day over the last 30. */
    baseline: number | null;
    refreshedAt: string | null;
  };
  /** View-weighted stance of each day's top posts. */
  stance: Array<{ day: string; score: number; posts: number }>;
  topPosts: SocialMentionPost[];
  /** Daily user views of the company's English Wikipedia article; absent on older servers. */
  wikipedia?: {
    article: string | null;
    days: Array<{ day: string; views: number }>;
    /** Median views over the 30 days ending at the last stored day. */
    baseline: number | null;
  };
  /** Posts and comments naming the ticker in finance subreddits, per finished UTC day; absent on older servers. */
  reddit?: {
    days: Array<{ day: string; mentions: number }>;
    baseline: number | null;
  };
  /** Parts still filling on the server; ask again shortly. */
  pending: Array<"history" | "posts">;
  warnings: string[];
}

export interface SocialMentionDayPosts {
  symbol: string;
  day: string;
  posts: SocialMentionPost[];
}

type CloudRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * The shared client owns the session cookie. This port cannot add a method on
 * `apiClient`, so the social-mentions routes call its request directly.
 */
function cloudRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const client = apiClient as unknown as { request: CloudRequest };
  return client.request(path, options);
}

export async function getCloudSocialMentions(
  symbol: string,
  range: SocialMentionsRange = "1y",
): Promise<SocialMentionsPayload> {
  const params = new URLSearchParams({ symbol, range });
  return cloudRequest<SocialMentionsPayload>(`/cloud/social-mentions?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
}

export async function getCloudSocialMentionPosts(
  symbol: string,
  day: string,
): Promise<SocialMentionDayPosts> {
  const params = new URLSearchParams({ symbol, day });
  return cloudRequest<SocialMentionDayPosts>(`/cloud/social-mentions/posts?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
}
