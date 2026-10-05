import { describe, expect, test } from "bun:test";
import {
  adjacentPriceTier,
  adjacentPriceWindow,
  adjacentRangeSupport,
  adjacentResolutionSupport,
} from "./price-window";
import { TIME_RANGES, type TimeRange } from "../../../time-series/range";

const DAY_MS = 86_400_000;

function startAgeMs(window: { start?: string }): number {
  return Date.now() - new Date(window.start ?? 0).getTime();
}

describe("adjacentPriceTier", () => {
  test("is keyed only when the transmitted key is non-empty", () => {
    expect(adjacentPriceTier({ requestApiKey: null })).toBe("public");
    expect(adjacentPriceTier({ requestApiKey: "ak_owned" })).toBe("keyed");
  });
});

describe("adjacentPriceWindow", () => {
  test("buckets 1D and 1W hourly and 1M and 3M daily on both tiers", () => {
    for (const tier of ["public", "keyed"] as const) {
      expect(adjacentPriceWindow("1D", tier).interval).toBe("1hour");
      expect(adjacentPriceWindow("1W", tier).interval).toBe("1hour");
      expect(adjacentPriceWindow("1M", tier).interval).toBe("1d");
      expect(adjacentPriceWindow("3M", tier).interval).toBe("1d");
    }
  });

  test("defaults to one page of ascending bars ending now", () => {
    const window = adjacentPriceWindow("1W", "keyed");
    expect(window.perPage).toBe(1000);
    expect(window.order).toBe("asc");
    expect(window.end).toBeUndefined();
    expect(startAgeMs(window)).toBeGreaterThan(7 * DAY_MS - 5_000);
    expect(startAgeMs(window)).toBeLessThan(7 * DAY_MS + 60_000);
  });

  test("keeps a public start inside the 30-day hourly ceiling", () => {
    const end = Date.now() - 20 * DAY_MS;
    const window = adjacentPriceWindow("1D", "public", { start: end - 25 * DAY_MS, end });
    expect(window.interval).toBe("1hour");
    expect(startAgeMs(window)).toBeLessThanOrEqual(30 * DAY_MS + 60_000);
    expect(window.end).toBe(new Date(end).toISOString());
  });

  test("clamps a public multi-year range to the 90-day daily ceiling", () => {
    for (const range of ["3M", "6M", "1Y", "5Y", "ALL"] as TimeRange[]) {
      const window = adjacentPriceWindow(range, "public");
      expect(window.interval).toBe("1d");
      const age = startAgeMs(window);
      expect(age).toBeLessThanOrEqual(90 * DAY_MS + 60_000);
      expect(age).toBeGreaterThanOrEqual(89 * DAY_MS);
    }
  });

  test("lets a keyed tier keep the full requested span", () => {
    const window = adjacentPriceWindow("1Y", "keyed");
    expect(window.interval).toBe("1d");
    expect(startAgeMs(window)).toBeGreaterThan(364 * DAY_MS);
  });

  test("derives the span and the instants from supplied bounds", () => {
    const start = Date.now() - 10 * DAY_MS;
    const end = Date.now() - 2 * DAY_MS;
    const window = adjacentPriceWindow("1Y", "keyed", { start, end });
    expect(window.interval).toBe("1hour");
    expect(window.start).toBe(new Date(start).toISOString());
    expect(window.end).toBe(new Date(end).toISOString());
  });

  test("falls back to the range span when bounds are incomplete", () => {
    const window = adjacentPriceWindow("1W", "keyed", { start: Date.now() - 400 * DAY_MS, end: null });
    expect(window.interval).toBe("1hour");
    expect(window.end).toBeUndefined();
    expect(startAgeMs(window)).toBeGreaterThan(7 * DAY_MS - 5_000);
  });
});

describe("adjacent range and resolution support", () => {
  test("advertises four public ranges and every range when keyed", () => {
    expect(adjacentRangeSupport("public")).toEqual(["1D", "1W", "1M", "3M"]);
    expect(adjacentRangeSupport("keyed")).toEqual(TIME_RANGES);
  });

  test("caps hourly bars at 1M and daily bars at the tier ceiling", () => {
    expect(adjacentResolutionSupport("public")).toEqual([
      { resolution: "1h", maxRange: "1M" },
      { resolution: "1d", maxRange: "3M" },
    ]);
    expect(adjacentResolutionSupport("keyed")).toEqual([
      { resolution: "1h", maxRange: "1M" },
      { resolution: "1d", maxRange: "ALL" },
    ]);
  });

  test("returns copies so a caller cannot poison the shared tables", () => {
    const ranges = adjacentRangeSupport("public");
    ranges.push("ALL");
    const resolutions = adjacentResolutionSupport("keyed");
    resolutions[1]!.maxRange = "3M";
    expect(adjacentRangeSupport("public")).toEqual(["1D", "1W", "1M", "3M"]);
    expect(adjacentResolutionSupport("keyed")).toEqual([
      { resolution: "1h", maxRange: "1M" },
      { resolution: "1d", maxRange: "ALL" },
    ]);
  });
});
