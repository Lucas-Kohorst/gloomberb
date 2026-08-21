import { describe, expect, test } from "bun:test";
import { CoinGeckoProvider } from "./provider";
import type { CoinGeckoHttp } from "./client";

describe("CoinGeckoProvider", () => {
  test("serves crypto quotes and leaves equities to other providers", async () => {
    const requested: string[] = [];
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        requested.push(path);
        if (path === "/simple/price") {
          return {
            bitcoin: {
              usd: 100_000,
              usd_market_cap: 2e12,
              usd_24h_vol: 1e10,
              usd_24h_change: 2,
            },
          };
        }
        throw new Error(`unexpected ${path}`);
      },
    };
    const provider = new CoinGeckoProvider(http);

    expect(provider.canProvide("BTC-USD", "CCC")).toBe(true);
    expect(provider.canProvide("SOL/USD")).toBe(true);
    expect(provider.canProvide("ZEC/USD")).toBe(true);
    expect(provider.canProvide("BTC", "CCC")).toBe(true);
    expect(provider.canProvide("AAPL", "NASDAQ")).toBe(false);

    const quote = await provider.getQuote("BTC-USD", "CCC");
    expect(quote.providerId).toBe("coingecko");
    expect(quote.price).toBe(100_000);
    expect(quote.marketCap).toBe(2e12);
    expect(requested).toEqual(["/simple/price"]);
    await expect(provider.getQuote("AAPL", "NASDAQ")).rejects.toThrow(/no mapping/i);
  });

  test("polls BTC-USD ETH-USD ZEC-USD quotes for portfolio subscribe", async () => {
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        if (path !== "/simple/price") throw new Error(`unexpected ${path}`);
        return {
          bitcoin: { usd: 111_000, usd_24h_change: 1.8, usd_market_cap: 2e12 },
          ethereum: { usd: 4_200, usd_24h_change: -0.6, usd_market_cap: 5e11 },
          zcash: { usd: 42.5, usd_24h_change: 3.1, usd_market_cap: 7e8 },
        };
      },
    };
    const provider = new CoinGeckoProvider(http);
    const quotes = new Map<string, number>();
    const unsubscribe = provider.subscribeQuotes([
      { symbol: "HOOD", exchange: "NASDAQ" },
      { symbol: "BTC-USD", exchange: "CCC" },
      { symbol: "ETH-USD", exchange: "CCC" },
      { symbol: "ZEC-USD", exchange: "CCC" },
    ], (target, quote) => {
      quotes.set(target.symbol, quote.price);
    });
    const started = Date.now();
    while (quotes.size < 3 && Date.now() - started < 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(quotes.get("BTC-USD")).toBe(111_000);
    expect(quotes.get("ETH-USD")).toBe(4_200);
    expect(quotes.get("ZEC-USD")).toBe(42.5);
    expect(quotes.has("HOOD")).toBe(false);
    unsubscribe();
  });
});
