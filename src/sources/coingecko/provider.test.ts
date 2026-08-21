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
});
