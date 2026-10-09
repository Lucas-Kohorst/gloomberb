import { describe, expect, test } from "bun:test";
import type { PricePoint } from "../../../types/financials";
import { computeTrendSummary, detectPatterns, maxDrawdown, sortinoRatio } from "./math";

function point(index: number, close: number): PricePoint {
  return { date: new Date(Date.UTC(2024, 0, index + 1)), open: close, high: close, low: close, close };
}

describe("price studies", () => {
  test("detects a constructed double top", () => {
    const closes = [
      100, 104, 108, 112, 116, 120,
      116, 110, 104, 98,
      104, 110, 116, 119,
      114, 108, 102, 96,
      94, 92, 90, 88, 86, 84,
    ];
    const matches = detectPatterns(closes.map((close, index) => point(index, close)), closes.length);
    const tops = matches.filter((match) => match.type === "double-top");
    expect(tops).toHaveLength(1);
    expect(tops[0]!.confidence).toBeGreaterThan(0.5);
    expect(tops[0]!.confidence).toBeLessThanOrEqual(0.9);
    expect(tops[0]!.description).toContain("120.00");
    expect(tops[0]!.description).toContain("119.00");
    expect(tops[0]).toMatchObject({ startIdx: 5, endIdx: 13 });
  });

  test("sortino and drawdown on a short series", () => {
    const values = [100, 110, 90, 100];
    const returns = [0.1, -20 / 110, 10 / 90];
    const downsideDeviation = (20 / 110) * Math.sqrt(252);
    const annualized = returns.reduce((sum, value) => sum + value, 0) / returns.length * 252;
    expect(maxDrawdown(values)).toBeCloseTo(20 / 110, 10);
    expect(sortinoRatio(values)).toBeCloseTo(annualized / downsideDeviation, 8);
  });

  test("trend alignment is bullish when price is above the 20, 50 and 200 averages", () => {
    const points = Array.from({ length: 220 }, (_, index) => point(index, 100 + index));
    const summary = computeTrendSummary(points);
    expect(summary.maAlignment).toBe("bullish");
    expect(summary.priceVsSma20).toBe("above");
    expect(summary.priceVsSma50).toBe("above");
    expect(summary.priceVsSma200).toBe("above");
    expect(summary.direction).toBe("bullish");
  });
});
