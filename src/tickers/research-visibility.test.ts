import { describe, expect, test } from "bun:test";
import type { TickerRecord } from "../types/ticker";
import { isAltInstrumentTicker, isEquityResearchTicker } from "./research-visibility";

function ticker(symbol: string, assetCategory?: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...(assetCategory ? { assetCategory } : {}),
    },
  };
}

describe("research-visibility", () => {
  test("treats prediction-market and prefixed series as alt instruments", () => {
    expect(isAltInstrumentTicker(ticker("POLY:clarity-act-signed-into-law-in-2026"))).toBe(true);
    expect(isAltInstrumentTicker(ticker("KALSHI:KXRAIN"))).toBe(true);
    expect(isAltInstrumentTicker(ticker("NVDA", "POLYMARKET"))).toBe(true);
    expect(isAltInstrumentTicker(ticker("ADJ:red"))).toBe(true);
    expect(isAltInstrumentTicker(ticker("FRED:FEDFUNDS"))).toBe(true);
    expect(isAltInstrumentTicker(ticker("AAPL"))).toBe(false);
    expect(isAltInstrumentTicker(ticker("BTC-USD", "CRYPTO"))).toBe(false);
  });

  test("hides equity research tabs for alt instruments", () => {
    expect(isEquityResearchTicker(ticker("AAPL"))).toBe(true);
    expect(isEquityResearchTicker(ticker("POLY:567621"))).toBe(false);
    expect(isEquityResearchTicker(null)).toBe(false);
  });
});
