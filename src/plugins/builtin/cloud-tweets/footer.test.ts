import { describe, expect, test } from "bun:test";
import {
  formatTwitterFeedStatusLine,
  twitterFeedStatusLabels,
  twitterFetchStaleLabel,
  twitterLivePollingLabel,
} from "./footer";

const NOW = Date.parse("2026-08-21T16:00:00.000Z");

describe("twitter feed footer status", () => {
  test("delayed plus a fresh fetch is delayed, not just now", () => {
    expect(twitterLivePollingLabel(false)).toBe("delayed");
    expect(twitterFetchStaleLabel(NOW, NOW)).toBeNull();
    expect(twitterFetchStaleLabel(NOW - 30_000, NOW)).toBeNull();
    expect(formatTwitterFeedStatusLine({
      livePolling: false,
      lastFetchedAt: NOW,
      now: NOW,
    })).toBe("delayed");
    expect(formatTwitterFeedStatusLine({
      livePolling: false,
      lastFetchedAt: NOW,
      now: NOW,
    })).not.toMatch(/just now|ran /);
  });

  test("delayed plus an old fetch shows stale age", () => {
    expect(twitterFetchStaleLabel(NOW - 5 * 60_000, NOW)).toBe("stale 5m");
    expect(twitterFetchStaleLabel(NOW - 90 * 60_000, NOW)).toBe("stale 1h");
    expect(formatTwitterFeedStatusLine({
      livePolling: false,
      lastFetchedAt: NOW - 12 * 60_000,
      now: NOW,
    })).toBe("delayed stale 12m");
  });

  test("live plus a fresh fetch is live", () => {
    expect(twitterLivePollingLabel(true)).toBe("live");
    expect(formatTwitterFeedStatusLine({
      livePolling: true,
      lastFetchedAt: NOW,
      now: NOW,
    })).toBe("live");
    expect(formatTwitterFeedStatusLine({
      livePolling: true,
      lastFetchedAt: NOW,
      now: NOW,
    })).not.toMatch(/just now|ran /);
  });

  test("live plus an old fetch shows stale without just now", () => {
    expect(formatTwitterFeedStatusLine({
      livePolling: true,
      lastFetchedAt: NOW - 8 * 60_000,
      now: NOW,
    })).toBe("live stale 8m");
  });

  test("missing fetch time still reports the polling tier", () => {
    expect(twitterFeedStatusLabels({ livePolling: false, lastFetchedAt: null, now: NOW })).toEqual({
      freshness: "delayed",
      stale: null,
    });
    expect(twitterFetchStaleLabel(undefined, NOW)).toBeNull();
  });
});
