import { describe, expect, test } from "bun:test";
import type { Quote, TickerFinancials } from "../../../../types/financials";
import type { TickerRecord } from "../../../../types/ticker";
import {
  needsVisibleQuoteWarmup,
  needsVisibleQuoteWatchdogRefresh,
  VISIBLE_QUOTE_STREAM_MAX_AGE_MS,
  warmupQuoteWithSnapshot,
} from "./data";

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "AAPL",
    price: 100,
    currency: "USD",
    change: 0,
    changePercent: 0,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

function financials(quoteValue: Quote): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    quote: quoteValue,
  };
}

describe("portfolio visible quote warmup", () => {
  test("refreshes current-session quotes once the visible-row age window expires", () => {
    const now = Date.now();
    const data = financials(quote({
      lastUpdated: now - VISIBLE_QUOTE_STREAM_MAX_AGE_MS,
      listingExchangeName: "FWB2",
      marketState: "REGULAR",
    }));

    expect(needsVisibleQuoteWarmup(data, now)).toBe(false);
    expect(needsVisibleQuoteWatchdogRefresh(data, now)).toBe(true);
  });

  test("treats stale active-session quotes as visible warmup misses", () => {
    const now = Date.parse("2026-07-07T12:10:30Z");
    const data = financials(quote({
      lastUpdated: Date.parse("2026-07-07T12:10:00Z"),
      listingExchangeName: "NASDAQ",
      marketState: "PRE",
    }));

    expect(needsVisibleQuoteWarmup(data, now)).toBe(true);
    expect(needsVisibleQuoteWatchdogRefresh(data, now)).toBe(true);
  });

  test("does not snapshot-warmup BTC-USD style rows when the portfolio sorts by market value", () => {
    const sort = { columnId: "mkt_value" as const, direction: "desc" as const };
    const crypto: TickerRecord = {
      metadata: {
        ticker: "BTC-USD",
        exchange: "CCC",
        currency: "USD",
        name: "Bitcoin USD",
        assetCategory: "CRYPTO",
        positions: [],
        portfolios: [],
        watchlists: [],
        custom: {},
        tags: [],
      },
    };
    const equity: TickerRecord = {
      metadata: {
        ticker: "HOOD",
        exchange: "NASDAQ",
        currency: "USD",
        name: "Robinhood",
        positions: [],
        portfolios: [],
        watchlists: [],
        custom: {},
        tags: [],
      },
    };

    expect(warmupQuoteWithSnapshot(crypto, true, sort)).toBe(false);
    expect(warmupQuoteWithSnapshot(equity, true, sort)).toBe(true);
  });
});
