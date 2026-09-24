import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../../test-support/plugin-persistence";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "../fetch";
import {
  buildPredictionCatalogLoadResourceKey,
  resolvePredictionCatalogOptions,
} from "../../cache";
import { loadKalshiCatalog, resetKalshiCatalogFeed } from "./adapter";

function market(ticker: string, volume24h: string) {
  return {
    ticker,
    title: `Will ${ticker} happen?`,
    event_ticker: `${ticker}-EVENT`,
    status: "open",
    market_type: "binary",
    last_price_dollars: "0.5",
    volume_24h_fp: volume24h,
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetKalshiCatalogFeed();
  resetPredictionMarketsPersistence();
  globalThis.fetch = originalFetch;
});

describe("Kalshi catalog ranking", () => {
  test("keeps browse resources separate while accepting the legacy options overload", () => {
    const topKey = buildPredictionCatalogLoadResourceKey(
      "kalshi",
      "all",
      "",
      "top",
      200,
      {},
    );
    const endingKey = buildPredictionCatalogLoadResourceKey(
      "kalshi",
      "all",
      "",
      "ending",
      200,
      {},
    );

    expect(endingKey).not.toBe(topKey);
    expect(resolvePredictionCatalogOptions("ending", { limit: 8 })).toEqual({
      browseTab: "ending",
      options: { limit: 8 },
    });
    expect(resolvePredictionCatalogOptions({ limit: 8 })).toEqual({
      browseTab: "top",
      options: { limit: 8 },
    });
  });

  test("loads the browse list from Adjacent sorted by volume, not Kalshi event pages", async () => {
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    const fetchUrls: string[] = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = new URL(String(input));
      fetchUrls.push(url.toString());
      if (url.hostname === "api.adjacent.markets" && url.pathname.includes("/markets")) {
        return new Response(JSON.stringify({
          data: [
            {
              market_id: "kalshi:WHALE",
              ticker: "WHALE",
              platform: "kalshi",
              question: "Will WHALE happen?",
              status: "active",
            },
            {
              market_id: "kalshi:SMALL",
              ticker: "SMALL",
              platform: "kalshi",
              question: "Will SMALL happen?",
              status: "active",
            },
          ],
          meta: { has_next: false },
        }), { status: 200 });
      }
      if (url.pathname.endsWith("/markets/WHALE") || url.pathname.endsWith("/markets/SMALL")) {
        const ticker = url.pathname.split("/").pop()!;
        return new Response(JSON.stringify({ market: market(ticker, ticker === "WHALE" ? "199586" : "500") }), { status: 200 });
      }
      throw new Error(`Unexpected catalog URL: ${url}`);
    }) as unknown as typeof fetch;

    const markets = await loadKalshiCatalog("", "all", "top", { force: true });

    expect(markets.map((entry) => entry.marketId)).toEqual(["WHALE", "SMALL"]);
    expect(fetchUrls.some((url) => url.includes("api.adjacent.markets") && url.includes("sort=volume"))).toBe(true);
    expect(fetchUrls.some((url) => url.includes("/events?"))).toBe(false);
  });
});
