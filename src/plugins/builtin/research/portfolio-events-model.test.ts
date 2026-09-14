import { describe, expect, test } from "bun:test";
import type { CorporateActionsData } from "../../../types/financials";
import { buildPortfolioEventRows } from "./portfolio-events-model";

function actions(symbol: string, date: string): CorporateActionsData {
  return {
    symbol,
    currency: "USD",
    dividends: [{ exDate: date, amount: 0.25 }],
    splits: [],
    earnings: [],
  };
}

describe("portfolio event rows", () => {
  test("normalizes symbols, deduplicates repeated collection entries, and sorts by date", () => {
    const rows = buildPortfolioEventRows([
      { symbol: " msft ", currency: "USD", data: actions("MSFT", "2026-06-01") },
      { symbol: "AAPL", currency: "USD", data: actions("AAPL", "2026-05-01") },
      { symbol: "MSFT", currency: "USD", data: actions("MSFT", "2026-06-01") },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => `${row.symbol}:${row.date}`)).toEqual([
      "AAPL:2026-05-01",
      "MSFT:2026-06-01",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "AAPL:div:2026-05-01",
      "MSFT:div:2026-06-01",
    ]);
  });
});
