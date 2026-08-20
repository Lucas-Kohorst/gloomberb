import { describe, expect, test } from "bun:test";
import { extractDividendSeries } from "./dividends";

describe("extractDividendSeries", () => {
  test("maps ex-date amounts in chronological order", () => {
    const points = extractDividendSeries({
      providerId: "yahoo-finance",
      symbol: "AAPL",
      dividends: [
        { exDate: "2026-02-09", amount: 0.26 },
        { exDate: "2025-11-07", amount: 0.25 },
        { exDate: "not-a-date", amount: 1 },
      ],
      splits: [],
      earnings: [],
    });
    expect(points.map((point) => ({ d: point.date.toISOString().slice(0, 10), v: point.value }))).toEqual([
      { d: "2025-11-07", v: 0.25 },
      { d: "2026-02-09", v: 0.26 },
    ]);
  });
});
