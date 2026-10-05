import { describe, expect, test } from "bun:test";
import type { TickerFinancials } from "../../../types/financials";
import { evaluateFormula, parseFormula } from "./formula";
import { joinWorksheetColumns, WORKSHEET_JOIN_CAP } from "./join";
import { parseViewSpec } from "./view-spec";

function sheet(columns: unknown[]) {
  const spec = parseViewSpec({
    source: { kind: "tickers", symbols: ["AAPL"] },
    projection: { columns },
    presentation: { symbolKey: "symbol" },
  });
  if (!spec) throw new Error("spec did not parse");
  return spec;
}

describe("worksheet formulas", () => {
  test("evaluates arithmetic over column names", () => {
    const parsed = parseFormula("(market.close - 10) / trailingPE");
    expect(parsed).not.toBeNull();
    expect(evaluateFormula(parsed!, (name) => name === "market.close" ? 28 : 14)).toBeCloseTo(1.2857, 3);
    expect(parseFormula("trailingPE +")).toBeNull();
    expect(evaluateFormula(parseFormula("1 / 0")!, () => null)).toBeNull();
  });
});

describe("worksheet column joins", () => {
  test("fills a chart field, a function field, and a formula without replacing screener price", async () => {
    const spec = sheet([
      "price",
      "market.close",
      "fundamental.totalRevenue",
      { key: "headline", from: { pane: "news", field: "headline" } },
      { key: "cheap", formula: "market.close / 2" },
    ]);
    const financials = {
      quote: { symbol: "AAPL", price: 99, change: 0, changePercent: 0, currency: "USD", lastUpdated: Date.now() },
      quarterlyStatements: [{ date: "2026-06-30", totalRevenue: 100 }],
      annualStatements: [],
      priceHistory: [],
    } as TickerFinancials;
    const joined = await joinWorksheetColumns(
      [{ symbol: "AAPL", price: 10 }],
      spec,
      new AbortController().signal,
      {
        quotes: async () => new Map([["AAPL", { price: 99, open: 1, high: 2, low: 3, volume: 4 }]]),
        financials: async () => financials,
        paneResult: async () => ({ rows: [{ headline: "Apple event" }] }),
      },
    );
    expect(joined.rows[0]).toMatchObject({
      price: 10,
      "market.close": 99,
      "fundamental.totalRevenue": 100,
      headline: "Apple event",
      cheap: 49.5,
    });
  });

  test("stops joining after the symbol cap", async () => {
    const symbols = Array.from({ length: WORKSHEET_JOIN_CAP + 1 }, (_, index) => `S${index}`);
    const spec = parseViewSpec({
      source: { kind: "tickers", symbols },
      projection: { columns: ["market.close"] },
    });
    if (!spec) throw new Error("spec did not parse");
    const seen: string[] = [];
    const joined = await joinWorksheetColumns(
      symbols.map((symbol) => ({ symbol })),
      spec,
      new AbortController().signal,
      { quotes: async (requested) => { seen.push(...requested); return new Map(); } },
    );
    expect(seen).toHaveLength(WORKSHEET_JOIN_CAP);
    expect(joined.errors[0]).toContain(`${WORKSHEET_JOIN_CAP} of ${symbols.length}`);
  });
});
