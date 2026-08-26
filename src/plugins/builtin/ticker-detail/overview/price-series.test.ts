import { describe, expect, test } from "bun:test";
import type { PricePoint, Quote } from "../../../../types/financials";
import { resolveOverviewPriceSeries } from "./price-series";

function point(iso: string, close: number, extra: Partial<PricePoint> = {}): PricePoint {
  return { date: new Date(iso), close, ...extra };
}

const OPTIONS = {
  id: "AAPL:price",
  label: "AAPL Price",
  color: "#00ff66",
  unit: "USD",
  style: "area" as const,
};

describe("resolveOverviewPriceSeries", () => {
  test("patches only the last bar when live quote updates the same timestamp", () => {
    const history = [
      point("2026-01-01T00:00:00.000Z", 100, { open: 99, high: 101, low: 98, volume: 10 }),
      point("2026-01-02T00:00:00.000Z", 104, { open: 103, high: 105, low: 102, volume: 12 }),
    ];
    const first = resolveOverviewPriceSeries(history, null, OPTIONS, null);
    const quote: Quote = {
      symbol: "AAPL",
      price: 106,
      currency: "USD",
      change: 2,
      changePercent: 1.9,
      lastUpdated: Date.parse("2026-01-02T15:00:00.000Z"),
    };
    const patched = resolveOverviewPriceSeries(history, quote, OPTIONS, first);

    expect(patched).not.toBe(first);
    expect(patched.points).toHaveLength(2);
    expect(patched.points[0]).toBe(first.points[0]);
    expect(patched.points[1]?.close).toBe(106);
    expect(patched.points[1]?.value).toBe(106);
  });

  test("returns the previous series when the last bar is unchanged", () => {
    const history = [
      point("2026-01-01T00:00:00.000Z", 100),
      point("2026-01-02T00:00:00.000Z", 104),
    ];
    const first = resolveOverviewPriceSeries(history, null, OPTIONS, null);
    const again = resolveOverviewPriceSeries(history, null, OPTIONS, first);
    expect(again).toBe(first);
  });
});
