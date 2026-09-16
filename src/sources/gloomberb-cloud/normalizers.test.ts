import { describe, expect, test } from "bun:test";
import { mapCloudFinancials, mapQuote } from "./normalizers";
import type { CloudQuotePayload } from "../../api-client";

describe("cloud quote wire values", () => {
  test.each([null, undefined, Number.NaN, Infinity, -Infinity])(
    "normalizes unavailable daily changes independently, including %s",
    (missing) => {
      const quote: CloudQuotePayload = {
        symbol: "VOD", currency: "GBp", price: 100, lastUpdated: 1,
        providerId: "gloomberb-cloud", dataSource: "delayed",
        change: missing, changePercent: 0,
      };
      const withoutChange = mapQuote(quote);
      expect(withoutChange.change).toBeNaN();
      expect(withoutChange.changePercent).toBe(0);
      const withoutPercent = mapQuote({ ...quote, change: 2, changePercent: missing });
      expect(withoutPercent.change).toBe(0.02);
      expect(withoutPercent.changePercent).toBeNaN();
    },
  );
});

describe("mapQuote session state", () => {
  const base = { price: 100, currency: "USD", change: 1, changePercent: 1, lastUpdated: Date.now() };

  test("derives REGULAR for crypto stream payloads that omit marketState", () => {
    const byExchange = mapQuote({ ...base, symbol: "BTC-USD", exchangeName: "CCC" });
    expect(byExchange.marketState).toBe("REGULAR");
    expect(byExchange.sessionConfidence).toBe("derived");

    const bySymbol = mapQuote({ ...base, symbol: "ZEC/USD" });
    expect(bySymbol.marketState).toBe("REGULAR");
  });

  test("leaves session state unknown for non-crypto payloads without marketState", () => {
    const quote = mapQuote({ ...base, symbol: "NVDA", exchangeName: "NASDAQ" });
    expect(quote.marketState).toBeUndefined();
  });

  test("keeps an explicit marketState from the backend", () => {
    const quote = mapQuote({ ...base, symbol: "NVDA", exchangeName: "NASDAQ", marketState: "CLOSED", sessionConfidence: "explicit" });
    expect(quote.marketState).toBe("CLOSED");
    expect(quote.sessionConfidence).toBe("explicit");
  });
});

describe("mapCloudFinancials", () => {
  test("divides GBp history with the raw quote currency, not the normalized GBP quote", () => {
    const financials = mapCloudFinancials({
      quote: {
        symbol: "VOD",
        price: 23.1,
        currency: "GBp",
        change: 1,
        changePercent: 4.5,
        lastUpdated: Date.parse("2026-05-13T15:00:00Z"),
        listingExchangeName: "LSE",
        exchangeName: "LSE",
      },
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [{
        date: "2026-05-13 10:15:00",
        open: 23,
        high: 23.4,
        low: 22.8,
        close: 23.1,
        volume: 1000,
      }],
    });

    expect(financials.quote?.currency).toBe("GBP");
    expect(financials.quote?.price).toBeCloseTo(0.231);
    expect(financials.priceHistory[0]?.close).toBeCloseTo(0.231);
    expect(financials.priceHistory[0]?.date.toISOString()).toBe("2026-05-13T09:15:00.000Z");
  });
});
