import { afterEach, describe, expect, test } from "bun:test";
import { KALSHI_PROXY_PATH } from "../../../../shared/hosted-api";
import { MemoryPluginPersistence } from "../../../../test-support/plugin-persistence";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "../fetch";
import { resetHostedAdjacentPathFallback } from "./adjacent-catalog";
import {
  getKalshiCatalogFeed,
  loadKalshiCatalog,
  loadMoreKalshiCatalog,
  resetKalshiCatalogFeed,
} from "./adapter";

const NBA_EVENT = {
  title: "Will the San Antonio win the 2026 Pro Basketball Finals?",
  category: "Sports",
  event_ticker: "KXNBA-26",
  series_ticker: "KXNBA",
  markets: [
    {
      ticker: "KXNBA-26-SAS",
      title: "Will the San Antonio win the 2026 Pro Basketball Finals?",
      yes_sub_title: "SAS",
      event_ticker: "KXNBA-26",
      status: "open",
      market_type: "binary",
      last_price_dollars: "0.72",
      volume_24h_fp: "15000",
    },
  ],
};

const originalFetch = globalThis.fetch;

const NBA_ADJACENT_ROW = {
  category: "Sports",
  display_ticker: "KXNBA-26-SAS",
  market_id: "kalshi:KXNBA-26-SAS",
  platform: "kalshi",
  probability: 65,
  question: "Will the San Antonio win the 2026 Pro Basketball Finals?",
  status: "active",
  ticker: "KXNBA-26-SAS",
  volume_24h: 1092341.9,
};

function setHosted(): void {
  (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED = true;
}

function clearHosted(): void {
  delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
}

afterEach(() => {
  clearHosted();
  resetKalshiCatalogFeed();
  resetHostedAdjacentPathFallback();
  resetPredictionMarketsPersistence();
  globalThis.fetch = originalFetch;
});

describe("hosted Kalshi catalog feed", () => {
  test("loads venue rows from the Kalshi CORS proxy, not Adjacent", async () => {
    setHosted();
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    const fetchUrls: string[] = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.includes(`${KALSHI_PROXY_PATH}/events`)) {
        return new Response(JSON.stringify({ events: [NBA_EVENT] }), {
          status: 200,
          headers: { "x-gloom-kalshi-source": "kalshi" },
        });
      }
      if (url.includes(`${KALSHI_PROXY_PATH}/markets`)) {
        return new Response(JSON.stringify({ markets: NBA_EVENT.markets }), {
          status: 200,
          headers: { "x-gloom-kalshi-source": "kalshi" },
        });
      }
      throw new Error(`Unexpected hosted catalog URL: ${url}`);
    }) as unknown as typeof fetch;

    const markets = await loadKalshiCatalog("", "all", "top", { force: true });

    expect(markets.some((market) => market.marketId === "KXNBA-26-SAS")).toBe(true);
    expect(markets.find((market) => market.marketId === "KXNBA-26-SAS")?.yesPrice).toBe(0.72);
    expect(fetchUrls.some((url) => url.includes(`${KALSHI_PROXY_PATH}/events`))).toBe(true);
    expect(fetchUrls.some((url) => url.includes("/api/feed/mkt"))).toBe(false);
    expect(fetchUrls.some((url) => url.includes("api.adjacent.markets"))).toBe(false);
    expect(getKalshiCatalogFeed()).toBe("live");
  });

  test("falls back to Adjacent only after the Kalshi proxy fails, and marks the feed delayed", async () => {
    setHosted();
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    const fetchUrls: string[] = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.includes(KALSHI_PROXY_PATH)) {
        return new Response("error code: 522", { status: 522 });
      }
      if (url.includes("/api/feed/mkt/markets") || url.includes("api.adjacent.markets")) {
        return new Response(
          JSON.stringify({
            data: [NBA_ADJACENT_ROW],
            meta: { has_next: false, page: 1, per_page: 50 },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fallback URL: ${url}`);
    }) as unknown as typeof fetch;

    const markets = await loadKalshiCatalog("", "all", "top", { force: true });

    expect(markets).toHaveLength(1);
    expect(markets[0]?.marketId).toBe("KXNBA-26-SAS");
    expect(markets[0]?.yesPrice).toBe(0.65);
    expect(fetchUrls.some((url) => url.includes(KALSHI_PROXY_PATH))).toBe(true);
    expect(
      fetchUrls.some((url) =>
        url.includes("/api/feed/mkt/markets") || url.includes("api.adjacent.markets"),
      ),
    ).toBe(true);
    expect(getKalshiCatalogFeed()).toBe("delayed");
  });

  test("keeps load-more on the Kalshi proxy while the live feed is active", async () => {
    setHosted();
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    const fetchUrls: string[] = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.includes(`${KALSHI_PROXY_PATH}/events`)) {
        return new Response(
          JSON.stringify({ events: [NBA_EVENT], cursor: "next-page" }),
          {
            status: 200,
            headers: { "x-gloom-kalshi-source": "kalshi" },
          },
        );
      }
      if (url.includes(`${KALSHI_PROXY_PATH}/markets`)) {
        return new Response(JSON.stringify({ markets: [] }), {
          status: 200,
          headers: { "x-gloom-kalshi-source": "kalshi" },
        });
      }
      throw new Error(`Unexpected hosted catalog URL: ${url}`);
    }) as unknown as typeof fetch;

    await loadKalshiCatalog("", "all", "top", { force: true });
    fetchUrls.length = 0;
    const page = await loadMoreKalshiCatalog("", "all", "next-page");

    expect(page.markets.some((market) => market.marketId === "KXNBA-26-SAS")).toBe(true);
    expect(fetchUrls.every((url) => url.includes(KALSHI_PROXY_PATH))).toBe(true);
    expect(fetchUrls.some((url) => url.includes("/api/feed/mkt"))).toBe(false);
    expect(getKalshiCatalogFeed()).toBe("live");
  });

  test("labels Worker Adjacent fallback as delayed even when the proxy returns 200", async () => {
    setHosted();
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes(`${KALSHI_PROXY_PATH}/events`)) {
        return new Response(JSON.stringify({ events: [NBA_EVENT] }), {
          status: 200,
          headers: { "x-gloom-kalshi-source": "adjacent" },
        });
      }
      if (url.includes(`${KALSHI_PROXY_PATH}/markets`)) {
        return new Response(JSON.stringify({ markets: [] }), {
          status: 200,
          headers: { "x-gloom-kalshi-source": "adjacent" },
        });
      }
      throw new Error(`Unexpected hosted catalog URL: ${url}`);
    }) as unknown as typeof fetch;

    const markets = await loadKalshiCatalog("", "all", "top", { force: true });
    expect(markets.some((market) => market.marketId === "KXNBA-26-SAS")).toBe(true);
    expect(getKalshiCatalogFeed()).toBe("delayed");
  });
});
