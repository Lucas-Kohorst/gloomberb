import { describe, expect, test } from "bun:test";
import { aggregateTo4h } from "./aggregate";
import type { PricePoint } from "../types/financials";

function point(
  iso: string,
  close: number,
  extra: Partial<Pick<PricePoint, "open" | "high" | "low" | "volume">> = {},
): PricePoint {
  return {
    date: new Date(iso),
    open: extra.open ?? close,
    high: extra.high ?? close,
    low: extra.low ?? close,
    close,
    ...(extra.volume !== undefined ? { volume: extra.volume } : {}),
  };
}

describe("aggregateTo4h", () => {
  test("returns empty for empty input", () => {
    expect(aggregateTo4h([])).toEqual([]);
  });

  test("groups hourly points into UTC-aligned 4-hour buckets", () => {
    const points = [
      point("2025-01-01T00:00:00Z", 100, { open: 100, high: 102, low: 99, volume: 10 }),
      point("2025-01-01T01:00:00Z", 101, { open: 100, high: 105, low: 98, volume: 20 }),
      point("2025-01-01T02:00:00Z", 103, { open: 101, high: 107, low: 100, volume: 30 }),
      point("2025-01-01T03:00:00Z", 104, { open: 103, high: 106, low: 102, volume: 40 }),
      point("2025-01-01T04:00:00Z", 105, { open: 104, high: 108, low: 104, volume: 50 }),
    ];

    const result = aggregateTo4h(points);

    expect(result).toHaveLength(2);
    expect(result[0]!.date).toEqual(new Date("2025-01-01T00:00:00Z"));
    expect(result[0]!.open).toBe(100);
    expect(result[0]!.high).toBe(107);
    expect(result[0]!.low).toBe(98);
    expect(result[0]!.close).toBe(104);
    expect(result[0]!.volume).toBe(100);
    expect(result[1]!.date).toEqual(new Date("2025-01-01T04:00:00Z"));
    expect(result[1]!.open).toBe(104);
    expect(result[1]!.close).toBe(105);
    expect(result[1]!.volume).toBe(50);
  });

  test("omits volume when no input points have volume", () => {
    const points = [
      point("2025-01-01T00:00:00Z", 100),
      point("2025-01-01T01:00:00Z", 102),
    ];
    const result = aggregateTo4h(points);
    expect(result).toHaveLength(1);
    expect(result[0]!.volume).toBeUndefined();
  });

  test("sums volume from only the points that define it", () => {
    const points = [
      point("2025-01-01T00:00:00Z", 100, { volume: 10 }),
      point("2025-01-01T01:00:00Z", 101),
      point("2025-01-01T02:00:00Z", 103, { volume: 5 }),
    ];
    const result = aggregateTo4h(points);
    expect(result[0]!.volume).toBe(15);
  });

  test("aligns to UTC midnight boundaries regardless of source offset", () => {
    const points = [
      point("2025-01-01T03:59:00Z", 99),
      point("2025-01-01T04:00:00Z", 100),
      point("2025-01-01T07:59:00Z", 101),
      point("2025-01-01T08:00:00Z", 102),
    ];
    const result = aggregateTo4h(points);
    expect(result).toHaveLength(3);
    expect(result[0]!.date).toEqual(new Date("2025-01-01T00:00:00Z"));
    expect(result[1]!.date).toEqual(new Date("2025-01-01T04:00:00Z"));
    expect(result[2]!.date).toEqual(new Date("2025-01-01T08:00:00Z"));
  });

  test("preserves ascending time order in output", () => {
    const points = [
      point("2025-01-01T08:00:00Z", 102),
      point("2025-01-01T00:00:00Z", 100),
      point("2025-01-01T04:00:00Z", 101),
    ];
    const result = aggregateTo4h(points);
    expect(result.map((p) => p.date.toISOString())).toEqual([
      "2025-01-01T00:00:00.000Z",
      "2025-01-01T04:00:00.000Z",
      "2025-01-01T08:00:00.000Z",
    ]);
  });

  test("uses chronological first and last bars within an unordered bucket", () => {
    const result = aggregateTo4h([
      point("2025-01-01T03:00:00Z", 103, { open: 102 }),
      point("2025-01-01T00:00:00Z", 100, { open: 99 }),
    ]);

    expect(result[0]!.open).toBe(99);
    expect(result[0]!.close).toBe(103);
  });

  test("falls back to close when open/high/low are undefined", () => {
    const points = [
      { date: new Date("2025-01-01T00:00:00Z"), close: 100 },
      { date: new Date("2025-01-01T01:00:00Z"), close: 105 },
    ];
    const result = aggregateTo4h(points);
    expect(result[0]!.open).toBe(100);
    expect(result[0]!.high).toBe(105);
    expect(result[0]!.low).toBe(100);
    expect(result[0]!.close).toBe(105);
  });
});
