import { expect, test } from "bun:test";
import type { PricePoint } from "../../../../types/financials";
import { buildReturnRows, filterPricePointsByWindow } from "./returns-model";

const point = (date: string, close: number): PricePoint => ({ date: new Date(date), close });

test("builds interval and cumulative returns from chronological prices", () => {
  const rows = buildReturnRows([
    point("2026-01-03T00:00:00Z", 110),
    point("2026-01-01T00:00:00Z", 100),
    point("2026-01-02T00:00:00Z", 105),
  ]);

  expect(rows.map(({ price, intervalChange, intervalPercent, cumulativeChange, cumulativePercent }) => ({
    price, intervalChange, intervalPercent, cumulativeChange, cumulativePercent,
  }))).toEqual([
    { price: 110, intervalChange: 5, intervalPercent: 5 / 105, cumulativeChange: 10, cumulativePercent: 0.1 },
    { price: 105, intervalChange: 5, intervalPercent: 0.05, cumulativeChange: 5, cumulativePercent: 0.05 },
    { price: 100, intervalChange: null, intervalPercent: null, cumulativeChange: 0, cumulativePercent: 0 },
  ]);
});

test("uses a hidden prior observation for the first interval while basing totals on the selected window", () => {
  const rows = buildReturnRows([
    point("2026-01-01T23:00:00Z", 100),
    point("2026-01-02T00:00:00Z", 110),
    point("2026-01-02T01:00:00Z", 121),
  ], Date.parse("2026-01-02T00:00:00Z"));

  expect(rows).toMatchObject([
    { price: 121, intervalChange: 11, intervalPercent: 0.1, cumulativeChange: 11, cumulativePercent: 0.1 },
    { price: 110, intervalChange: 10, intervalPercent: 0.1, cumulativeChange: 0, cumulativePercent: 0 },
  ]);
});

test("filters invalid and out-of-window samples and handles zero baselines", () => {
  const rows = buildReturnRows(filterPricePointsByWindow([
    point("2026-01-03T00:00:00Z", 5),
    point("2026-01-01T00:00:00Z", 0),
    point("2026-01-02T00:00:00Z", 4),
    point("2025-12-31T00:00:00Z", 99),
  ], Date.parse("2026-01-01T00:00:00Z"), Date.parse("2026-01-03T00:00:00Z")));

  expect(rows.map((row) => row.price)).toEqual([5, 4, 0]);
  expect(rows[0]?.intervalPercent).toBe(0.25);
  expect(rows[0]?.cumulativePercent).toBeNull();
  expect(rows[1]?.intervalPercent).toBeNull();
});
