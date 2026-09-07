import { describe, expect, test } from "bun:test";
import { nextAutoRefreshDelayMs } from "./use-auto-refresh";

describe("nextAutoRefreshDelayMs", () => {
  test("waits a full interval when nothing has loaded yet", () => {
    expect(nextAutoRefreshDelayMs(null, 5 * 60_000, 1_000)).toBe(5 * 60_000);
  });

  test("waits only the remaining freshness after a recent load", () => {
    const intervalMs = 5 * 60_000;
    const now = 10 * 60_000;
    expect(nextAutoRefreshDelayMs(now - 2 * 60_000, intervalMs, now)).toBe(3 * 60_000);
  });

  test("fires immediately once the data is already stale", () => {
    const intervalMs = 5 * 60_000;
    const now = 10 * 60_000;
    expect(nextAutoRefreshDelayMs(now - 7 * 60_000, intervalMs, now)).toBe(0);
  });
});
