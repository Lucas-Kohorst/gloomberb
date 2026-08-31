import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../../test-support/plugin-persistence";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "../fetch";
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
  test("reranks past the first events page instead of reusing the first-paint cache", async () => {
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    const pagesFetched: string[] = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/events")) {
        const cursor = url.searchParams.get("cursor");
        pagesFetched.push(cursor ?? "page1");
        // Kalshi returns events in no volume order, so the leader sits on page 2.
        if (!cursor) {
          return new Response(
            JSON.stringify({ events: [{ title: "Quiet", markets: [market("SMALL", "500")] }], cursor: "page2" }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ events: [{ title: "Busy", markets: [market("WHALE", "199586")] }] }),
          { status: 200 },
        );
      }
      if (url.pathname.endsWith("/markets")) {
        return new Response(JSON.stringify({ markets: [] }), { status: 200 });
      }
      throw new Error(`Unexpected catalog URL: ${url}`);
    }) as unknown as typeof fetch;

    const firstPaint = await loadKalshiCatalog("", "all", "top", { firstPageOnly: true });
    expect(firstPaint.map((entry) => entry.marketId)).toEqual(["SMALL"]);
    expect(pagesFetched).toEqual(["page1"]);

    const deep = await loadKalshiCatalog("", "all", "top");

    expect(pagesFetched).toContain("page2");
    expect(deep[0]?.marketId).toBe("WHALE");
    expect(deep.map((entry) => entry.marketId)).toEqual(["WHALE", "SMALL"]);
  });
});
