import { describe, expect, test } from "bun:test";
import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { buildTickerListRowRevision } from "./list-table-view";

function makeTicker(positions: TickerRecord["metadata"]["positions"] = []): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple Inc.",
      portfolios: [],
      watchlists: [],
      positions,
      custom: {},
      tags: [],
    },
  };
}

function makeFinancials(overrides: Partial<NonNullable<TickerFinancials["quote"]>> = {}): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [{ date: new Date("2026-01-01"), close: 200 }],
    quote: {
      symbol: "AAPL",
      price: 200,
      currency: "USD",
      change: 1,
      changePercent: 0.5,
      lastUpdated: 1,
      ...overrides,
    },
  };
}

describe("buildTickerListRowRevision", () => {
  test("stays stable when only unused quote fields change", () => {
    const ticker = makeTicker();
    const first = buildTickerListRowRevision(ticker, makeFinancials({ name: "Apple" }), "");
    const second = buildTickerListRowRevision(ticker, makeFinancials({ name: "Apple Inc." }), "");
    expect(first).toBe(second);
  });

  test("changes when volume or market cap updates", () => {
    const ticker = makeTicker();
    const base = buildTickerListRowRevision(ticker, makeFinancials({ volume: 1 }), "");
    const volume = buildTickerListRowRevision(ticker, makeFinancials({ volume: 2 }), "");
    const cap = buildTickerListRowRevision(ticker, makeFinancials({ volume: 1, marketCap: 3 }), "");
    expect(volume).not.toBe(base);
    expect(cap).not.toBe(base);
  });

  test("changes when revisionScope or position size updates", () => {
    const ticker = makeTicker();
    const scoped = buildTickerListRowRevision(ticker, makeFinancials(), "", "100|USD");
    const rescope = buildTickerListRowRevision(ticker, makeFinancials(), "", "101|USD");
    const sized = buildTickerListRowRevision(
      makeTicker([{ portfolio: "main", shares: 10, avgCost: 1, broker: "manual" }]),
      makeFinancials(),
      "",
      "100|USD",
    );
    expect(rescope).not.toBe(scoped);
    expect(sized).not.toBe(scoped);
  });
});
