import { describe, expect, test } from "bun:test";
import { fetchYahooQuotes } from "./requests";
import { loadYahooQuote, loadYahooQuotes, loadYahooTickerFinancials } from "./snapshots";
import type { YahooHttpClient } from "./http";

describe("Yahoo quote snapshots", () => {
  test("fetchYahooQuotes uses v7/finance/quote and not a 1mo chart", async () => {
    const urls: string[] = [];
    const http = {
      fetchJsonWithCrumb: async (url: string) => {
        urls.push(url);
        return {
          quoteResponse: {
            result: [
              { symbol: "AAPL", regularMarketPrice: 190, currency: "USD", marketState: "REGULAR" },
              { symbol: "MSFT", regularMarketPrice: 420, currency: "USD", marketState: "REGULAR" },
            ],
          },
        };
      },
    } as YahooHttpClient;

    const result = await fetchYahooQuotes(http, ["AAPL", "MSFT"]);

    expect(result.map((row) => row.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("https://query1.finance.yahoo.com/v7/finance/quote?");
    expect(new URL(urls[0]!).searchParams.get("symbols")).toBe("AAPL,MSFT");
    expect(urls[0]).not.toContain("1mo");
    expect(urls[0]).not.toContain("/v8/finance/chart");
  });

  test("loadYahooQuote does not call fetchChart with 1mo", async () => {
    const quote = await loadYahooQuote("AAPL", {
      fetchQuotes: async () => [{
        symbol: "AAPL",
        currency: "USD",
        regularMarketPrice: 190,
        regularMarketChange: 2,
        regularMarketChangePercent: 1.0638,
        regularMarketPreviousClose: 188,
        regularMarketOpen: 189,
        regularMarketDayHigh: 191,
        regularMarketDayLow: 187,
        fiftyTwoWeekHigh: 260,
        fiftyTwoWeekLow: 164,
        regularMarketVolume: 52_000_000,
        marketCap: 2_900_000_000_000,
        shortName: "Apple Inc.",
        exchange: "NMS",
        fullExchangeName: "NasdaqGS",
        marketState: "REGULAR",
        bid: 189.9,
        ask: 190.1,
        regularMarketTime: 1_700_000_000,
      }],
      fetchExtendedHoursData: async () => {
        throw new Error("extended hours should not load in REGULAR");
      },
      providerId: "yahoo",
    });

    expect(quote).toMatchObject({
      symbol: "AAPL",
      providerId: "yahoo",
      price: 190,
      change: 2,
      previousClose: 188,
      high52w: 260,
      low52w: 164,
      volume: 52_000_000,
      marketCap: 2_900_000_000_000,
      marketState: "REGULAR",
      sessionConfidence: "explicit",
      dataSource: "delayed",
      bid: 189.9,
      ask: 190.1,
    });
  });

  test("loadYahooQuotes maps one multi-symbol payload without a 1mo chart", async () => {
    const requested: string[][] = [];
    const quotes = await loadYahooQuotes(["AAPL", "MSFT"], {
      fetchQuotes: async (symbols) => {
        requested.push(symbols);
        return [
          { symbol: "AAPL", currency: "USD", regularMarketPrice: 190, marketState: "REGULAR" },
          { symbol: "MSFT", currency: "USD", regularMarketPrice: 420, marketState: "REGULAR" },
        ];
      },
      fetchExtendedHoursData: async () => ({}),
      providerId: "yahoo",
    });

    expect(requested).toEqual([["AAPL", "MSFT"]]);
    expect(quotes.get("AAPL")?.price).toBe(190);
    expect(quotes.get("MSFT")?.price).toBe(420);
  });

  test("loadYahooTickerFinancials uses a 5y weekly chart, not a daily 5y dump", async () => {
    const charts: Array<{ range: string; interval?: string }> = [];
    const financials = await loadYahooTickerFinancials("AAPL", {
      fetchAssetProfile: async () => undefined,
      fetchChart: async (_symbol, range, interval) => {
        charts.push({ range, interval });
        return {
          meta: { currency: "USD", regularMarketPrice: 190, shortName: "Apple" },
          history: [
            { date: new Date("2025-01-01T00:00:00Z"), close: 180 },
            { date: new Date("2026-01-01T00:00:00Z"), close: 190 },
          ],
        };
      },
      fetchExtendedHoursData: async () => ({}),
      fetchQuoteSupplement: async () => ({}),
      fetchTimeseries: async () => [],
      providerId: "yahoo",
    });

    expect(charts).toEqual([{ range: "5y", interval: "1wk" }]);
    expect(financials.quote?.price).toBe(190);
    expect(financials.priceHistory).toHaveLength(2);
  });
});
