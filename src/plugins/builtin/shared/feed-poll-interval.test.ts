import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PREDICTION_CATALOG_POLL_INTERVAL_MINUTES,
  DEFAULT_TWITTER_POLL_INTERVAL_MINUTES,
  formatPollIntervalFooterLabel,
  isXLivePollingEnabled,
  nextPollIntervalMinutes,
  pollFooterTrailingInfo,
  pollIntervalMenuOptions,
  resolveFeedPollIntervalMinutes,
  twitterLivePollIntervalMinutes,
  X_LIVE_POLLING_CONFIG_KEY,
} from "./feed-poll-interval";

describe("feed poll interval", () => {
  test("formats the footer label from minutes", () => {
    expect(formatPollIntervalFooterLabel(1)).toBe("poll 1m");
    expect(formatPollIntervalFooterLabel(30)).toBe("poll 30m");
  });

  test("exposes the shared 1/5/15/30 minute option list", () => {
    expect(pollIntervalMenuOptions()).toEqual([
      { value: "1", label: "1 minute" },
      { value: "5", label: "5 minutes" },
      { value: "15", label: "15 minutes" },
      { value: "30", label: "30 minutes" },
    ]);
  });

  test("cycles 1 → 5 → 15 → 30 → 1", () => {
    expect(nextPollIntervalMinutes(1)).toBe(5);
    expect(nextPollIntervalMinutes(5)).toBe(15);
    expect(nextPollIntervalMinutes(15)).toBe(30);
    expect(nextPollIntervalMinutes(30)).toBe(1);
  });

  test("snaps unknown values up to the next option", () => {
    expect(nextPollIntervalMinutes(2)).toBe(5);
    expect(nextPollIntervalMinutes(60)).toBe(1);
  });

  test("prediction catalog and twitter defaults are 5 minutes, not the global RI", () => {
    expect(DEFAULT_TWITTER_POLL_INTERVAL_MINUTES).toBe(5);
    expect(DEFAULT_PREDICTION_CATALOG_POLL_INTERVAL_MINUTES).toBe(5);
  });

  test("prefers a stored override, then a pane default, then the global RI", () => {
    expect(resolveFeedPollIntervalMinutes(30, null, undefined)).toBe(30);
    expect(resolveFeedPollIntervalMinutes(30, null, DEFAULT_PREDICTION_CATALOG_POLL_INTERVAL_MINUTES)).toBe(5);
    expect(resolveFeedPollIntervalMinutes(30, 15, DEFAULT_PREDICTION_CATALOG_POLL_INTERVAL_MINUTES)).toBe(15);
    expect(resolveFeedPollIntervalMinutes(30, "5", DEFAULT_TWITTER_POLL_INTERVAL_MINUTES)).toBe(5);
  });

  test("keeps a stored 1-minute override when the pane default is 5", () => {
    expect(resolveFeedPollIntervalMinutes(30, 1, DEFAULT_TWITTER_POLL_INTERVAL_MINUTES)).toBe(1);
    expect(resolveFeedPollIntervalMinutes(30, "1", DEFAULT_PREDICTION_CATALOG_POLL_INTERVAL_MINUTES)).toBe(1);
  });

  test("omits the poll chip when article chrome should not poll", () => {
    const segment = {
      id: "poll-interval",
      parts: [{ text: "poll 30m", tone: "muted" as const }],
    };
    expect(pollFooterTrailingInfo(true, segment)).toEqual([segment]);
    expect(pollFooterTrailingInfo(false, segment)).toEqual([]);
  });

  test("X live polling interval is 0 until xLivePollingEnabled is true", () => {
    expect(X_LIVE_POLLING_CONFIG_KEY).toBe("xLivePollingEnabled");
    expect(isXLivePollingEnabled(undefined)).toBe(false);
    expect(isXLivePollingEnabled(true)).toBe(true);
    expect(twitterLivePollIntervalMinutes(false, 1)).toBe(0);
    expect(twitterLivePollIntervalMinutes(true, 5)).toBe(5);
  });
});
