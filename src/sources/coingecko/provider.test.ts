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

  test("prices many crypto ids with one simple/price request", async () => {
    const priceCalls: Array<string | number | undefined> = [];
    const http: CoinGeckoHttp = {
      async fetchJson(path, search) {
        if (path === "/search") throw new Error("batch must not search known bases");
        if (path !== "/simple/price") throw new Error(`unexpected ${path}`);
        priceCalls.push(search?.ids);
        return {
          bitcoin: { usd: 111_000, usd_24h_change: 1.8 },
          ethereum: { usd: 4_200, usd_24h_change: -0.6 },
          zcash: { usd: 42.5, usd_24h_change: 3.1 },
        };
      },
    };
    const provider = new CoinGeckoProvider(http);
    const results = await provider.getQuotesBatch([
      { symbol: "BTC-USD", exchange: "CCC" },
      { symbol: "ETH-USD", exchange: "CCC" },
      { symbol: "ZEC-USD", exchange: "CCC" },
      { symbol: "COIN", exchange: "NASDAQ" },
    ]);
    expect(priceCalls).toEqual(["bitcoin,ethereum,zcash"]);
    expect(results.map((item) => [item.target.symbol, item.quote?.price ?? null])).toEqual([
      ["BTC-USD", 111_000],
      ["ETH-USD", 4_200],
      ["ZEC-USD", 42.5],
      ["COIN", null],
    ]);
  });

  test("does not poll hidden crypto rows and does not search COIN", async () => {
    const requested: string[] = [];
    const http: CoinGeckoHttp = {
      async fetchJson(path, search) {
        requested.push(`${path}:${search?.ids ?? search?.query ?? ""}`);
        if (path !== "/simple/price") throw new Error(`unexpected ${path}`);
        return { bitcoin: { usd: 111_000, usd_24h_change: 1.8 } };
      },
    };
    const provider = new CoinGeckoProvider(http);
    const quotes = new Map<string, number>();
    const unsubscribe = provider.subscribeQuotes([
      { symbol: "BTC-USD", exchange: "CCC", visible: true, weight: 80 },
      { symbol: "ETH-USD", exchange: "CCC", visible: false, selected: false, weight: 10 },
      { symbol: "COIN", exchange: "NASDAQ", visible: true },
    ], (target, quote) => {
      quotes.set(target.symbol, quote.price);
    });
    const started = Date.now();
    while (quotes.size < 1 && Date.now() - started < 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(quotes.get("BTC-USD")).toBe(111_000);
    expect(quotes.has("ETH-USD")).toBe(false);
    expect(requested).toEqual(["/simple/price:bitcoin"]);
    unsubscribe();
  });

  test("reuses a searched CoinGecko id across quote ticks", async () => {
    let searches = 0;
    let prices = 0;
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        if (path === "/search") {
          searches += 1;
          return { coins: [{ id: "foo-token", name: "Foo", symbol: "FOO", market_cap_rank: 28 }] };
        }
        if (path === "/simple/price") {
          prices += 1;
          return { "foo-token": { usd: 1.25, usd_24h_change: 1 } };
        }
        throw new Error(`unexpected ${path}`);
      },
    };
    const provider = new CoinGeckoProvider(http);
    await provider.getQuote("FOO", "CCC");
    await provider.getQuote("FOO", "CCC");
    await provider.getQuotesBatch([{ symbol: "FOO", exchange: "CCC" }]);
    expect(searches).toBe(1);
    expect(prices).toBe(3);
  });

  test("does not resolve COIN to a CoinGecko name hit", async () => {
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        if (path !== "/search") throw new Error(`unexpected ${path}`);
        return {
          coins: [
            { id: "bitcoin", name: "Bitcoin", symbol: "btc", market_cap_rank: 1 },
            { id: "dogecoin", name: "Dogecoin", symbol: "doge", market_cap_rank: 11 },
          ],
        };
      },
    };
    const provider = new CoinGeckoProvider(http);
    expect(await provider.search("COIN")).toEqual([]);
    expect(provider.canProvide("COIN", "NASDAQ")).toBe(false);
  });

  test("picks the highest-ranked exact symbol when mapping an unknown CCC coin", async () => {
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        if (path === "/search") {
          return {
            coins: [
              { id: "obscure-foo", name: "Obscure Foo", symbol: "FOO", market_cap_rank: 900 },
              { id: "foo-token", name: "Foo", symbol: "FOO", market_cap_rank: 28 },
            ],
          };
        }
        if (path === "/simple/price") {
          return { "foo-token": { usd: 1.25, usd_24h_change: 1 } };
        }
        throw new Error(`unexpected ${path}`);
      },
    };
    const provider = new CoinGeckoProvider(http);
    const quote = await provider.getQuote("FOO", "CCC");
    expect(quote.price).toBe(1.25);
  });

  test("fills ETH snapshot 52W% from max market chart history", async () => {
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        if (path === "/coins/ethereum") {
          return {
            name: "Ethereum",
            market_data: {
              current_price: { usd: 4_400 },
              price_change_percentage_24h: 1.2,
              market_cap: { usd: 510_000_000_000 },
              total_volume: { usd: 20_000_000_000 },
            },
          };
        }
        if (path === "/coins/ethereum/market_chart") {
          return {
            prices: [
              [Date.parse("2025-01-01T00:00:00Z"), 2_200],
              [Date.parse("2026-01-01T00:00:00Z"), 4_400],
            ],
            total_volumes: [],
          };
        }
        throw new Error(`unexpected ${path}`);
      },
    };
    const provider = new CoinGeckoProvider(http);
    const financials = await provider.getTickerFinancials("ETH-USD", "CCC");
    expect(financials.fundamentals?.return1Y).toBe(1);
    expect(financials.priceHistory).toHaveLength(2);
    expect(financials.quote?.marketCap).toBe(510_000_000_000);
  });
});
