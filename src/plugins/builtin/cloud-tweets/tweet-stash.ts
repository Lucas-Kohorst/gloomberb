import type { CloudTweetPayload } from "../../../api-client";

const stash = new Map<string, CloudTweetPayload>();

export function tweetAuthorHandle(tweet: CloudTweetPayload): string {
  const username = tweet.author.userName || tweet.author.name;
  return username ? `@${username}` : "Tweet";
}

export function serializeTweetPayload(tweet: CloudTweetPayload): string {
  return JSON.stringify(tweet);
}

export function parseTweetPayload(value: unknown): CloudTweetPayload | null {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const tweet = raw as CloudTweetPayload;
  if (typeof tweet.id !== "string" || !tweet.id.trim()) return null;
  if (typeof tweet.text !== "string") return null;
  if (!tweet.author || typeof tweet.author !== "object") return null;
  if (!tweet.metrics || typeof tweet.metrics !== "object") return null;
  return tweet;
}

export function stashTweet(tweet: CloudTweetPayload): void {
  stash.set(tweet.id, tweet);
}

export function getStashedTweet(tweetId: string): CloudTweetPayload | null {
  return stash.get(tweetId) ?? null;
}
