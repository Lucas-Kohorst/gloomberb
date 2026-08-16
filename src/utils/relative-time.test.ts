import { describe, expect, test } from "bun:test";
import { formatApproximateAge } from "./relative-time";

const NOW = 1_700_000_000_000;

describe("formatApproximateAge", () => {
  test("clamps sub-minute and invalid timestamps to ~0m", () => {
    expect(formatApproximateAge(null, NOW)).toBe("~0m");
    expect(formatApproximateAge(undefined, NOW)).toBe("~0m");
    expect(formatApproximateAge(NaN, NOW)).toBe("~0m");
    expect(formatApproximateAge(NOW, NOW)).toBe("~0m");
    expect(formatApproximateAge(NOW - 30_000, NOW)).toBe("~0m");
  });

  test("formats minutes, hours, and days", () => {
    expect(formatApproximateAge(NOW - 5 * 60_000, NOW)).toBe("~5m");
    expect(formatApproximateAge(NOW - 59 * 60_000, NOW)).toBe("~59m");
    expect(formatApproximateAge(NOW - 60 * 60_000, NOW)).toBe("~1h");
    expect(formatApproximateAge(NOW - 23 * 60 * 60_000, NOW)).toBe("~23h");
    expect(formatApproximateAge(NOW - 24 * 60 * 60_000, NOW)).toBe("~1d");
    expect(formatApproximateAge(NOW - 6 * 24 * 60 * 60_000, NOW)).toBe("~6d");
    expect(formatApproximateAge(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe("~1w");
  });

  test("clamps future timestamps to ~0m", () => {
    expect(formatApproximateAge(NOW + 5 * 60_000, NOW)).toBe("~0m");
  });
});
