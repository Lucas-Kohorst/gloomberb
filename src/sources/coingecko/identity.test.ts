import { describe, expect, test } from "bun:test";
import type { CoinGeckoHttp } from "./client";
import { CoinGeckoIdentityCache } from "./identity";

describe("CoinGeckoIdentityCache", () => {
  test("maps known bases without searching", async () => {
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        throw new Error(`unexpected ${path}`);
      },
    };
    const cache = new CoinGeckoIdentityCache(http);
    const pair = await cache.resolve("BTC-USD", "CCC");
    expect(pair).toMatchObject({ id: "bitcoin", base: "BTC", vsCurrency: "usd" });
    expect(await cache.resolve("BTC-USD", "CCC")).toEqual(pair);
  });

  test("searches an unknown CCC coin once and reuses the id", async () => {
    let searches = 0;
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        if (path !== "/search") throw new Error(`unexpected ${path}`);
        searches += 1;
        return {
          coins: [
            { id: "obscure-foo", name: "Obscure Foo", symbol: "FOO", market_cap_rank: 900 },
            { id: "foo-token", name: "Foo", symbol: "FOO", market_cap_rank: 28 },
          ],
        };
      },
    };
    const cache = new CoinGeckoIdentityCache(http);
    const first = await cache.resolve("FOO", "CCC");
    const second = await cache.resolve("FOO", "CCC");
    expect(first?.id).toBe("foo-token");
    expect(second).toEqual(first);
    expect(searches).toBe(1);
  });

  test("does not search CoinGecko for COIN in a US equity context", async () => {
    const http: CoinGeckoHttp = {
      async fetchJson(path) {
        throw new Error(`unexpected ${path}`);
      },
    };
    const cache = new CoinGeckoIdentityCache(http);
    expect(await cache.resolve("COIN", "NASDAQ")).toBeNull();
    expect(await cache.resolve("COIN", "")).toBeNull();
    expect(await cache.resolve("COIN", "NYSE")).toBeNull();
  });
});
