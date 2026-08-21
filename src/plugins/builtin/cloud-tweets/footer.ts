import { useEffect, useState } from "react";

/** Fetch age at which the footer starts saying the poll itself is stale. */
export const TWITTER_FETCH_STALE_MS = 60_000;

export type TwitterLivePollingLabel = "live" | "delayed";

export function twitterLivePollingLabel(livePolling: boolean): TwitterLivePollingLabel {
  return livePolling ? "live" : "delayed";
}

/**
 * Age of the last successful poll. Fresh fetches return null so "just now"
 * never sits next to delayed/live — delayed already means the data is not a
 * live firehose, and just-now is read as "these tweets are realtime."
 */
export function twitterFetchStaleLabel(
  lastFetchedAt: number | null | undefined,
  now = Date.now(),
): string | null {
  if (lastFetchedAt == null || !Number.isFinite(lastFetchedAt)) return null;
  const ageMs = Math.max(0, now - lastFetchedAt);
  if (ageMs < TWITTER_FETCH_STALE_MS) return null;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `stale ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `stale ${hours}h`;
  const days = Math.floor(hours / 24);
  return `stale ${days}d`;
}

export function twitterFeedStatusLabels(input: {
  livePolling: boolean;
  lastFetchedAt: number | null | undefined;
  now?: number;
}): { freshness: TwitterLivePollingLabel; stale: string | null } {
  return {
    freshness: twitterLivePollingLabel(input.livePolling),
    stale: twitterFetchStaleLabel(input.lastFetchedAt, input.now),
  };
}

/** Concatenated footer texts for assertions. Never includes "just now" or "ran". */
export function formatTwitterFeedStatusLine(input: {
  livePolling: boolean;
  lastFetchedAt: number | null | undefined;
  now?: number;
}): string {
  const { freshness, stale } = twitterFeedStatusLabels(input);
  return stale ? `${freshness} ${stale}` : freshness;
}

/** Re-render once a minute so a sitting pane can pick up `stale Xm`. */
export function useTwitterFetchStaleLabel(lastFetchedAt: number | null | undefined): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!lastFetchedAt) return;
    const interval = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(interval);
  }, [lastFetchedAt]);
  return twitterFetchStaleLabel(lastFetchedAt);
}
