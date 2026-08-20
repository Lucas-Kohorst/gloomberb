import { describe, expect, test } from "bun:test";
import {
  formatPollIntervalFooterLabel,
  nextPollIntervalMinutes,
  resolveFeedPollIntervalMinutes,
} from "./feed-poll-interval";

describe("feed poll interval", () => {
  test("formats the footer label from minutes", () => {
    expect(formatPollIntervalFooterLabel(1)).toBe("poll 1m");
    expect(formatPollIntervalFooterLabel(30)).toBe("poll 30m");
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

  test("prefers a stored override, then a pane default, then the global RI", () => {
    expect(resolveFeedPollIntervalMinutes(30, null, undefined)).toBe(30);
    expect(resolveFeedPollIntervalMinutes(30, null, 1)).toBe(1);
    expect(resolveFeedPollIntervalMinutes(30, 15, 1)).toBe(15);
  });
});
