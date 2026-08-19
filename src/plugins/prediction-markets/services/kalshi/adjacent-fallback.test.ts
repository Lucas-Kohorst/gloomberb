import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../../utils/http-transport";
import { loadKalshiCatalog, loadKalshiHistory, resolveKalshiMarketByTicker } from "./adapter";
import {
  kalshiSeriesTickerFromEvent,
  normalizeKalshiAdjacentMarket,
} from "./adjacent-fallback";

afterEach(() => {
  setHttpFetchTransport(null);
});

describe("Kalshi Adjacent fallback mapping", () => {
  test("maps public Adjacent Kalshi markets onto venue summaries", () => {
    const summary = normalizeKalshiAdjacentMarket({
      market_id: "kalshi:KXPRESNOMD-28-REMA",
      ticker: "KXPRESNOMD-28-REMA",
      platform: "kalshi",
      question: "2028 Democratic presidential nominee",
      description: "Rahm Emanuel",
      link: "https://kalshi.com/markets/kxpresnomd",
      probability: 12,
      volume_24h: 300925.55,
      open_interest: 1000,
      event_ticker: "KXPRESNOMD-28",
      status: "active",
      category: "Elections",
      end_date: "2028-11-07T00:00:00Z",
      settlement: "Democratic Party",
    });

    expect(summary).toMatchObject({
      key: "kalshi:KXPRESNOMD-28-REMA",
      venue: "kalshi",
      marketId: "KXPRESNOMD-28-REMA",
      title: "2028 Democratic presidential nominee",
      marketLabel: "Rahm Emanuel",
      eventTicker: "KXPRESNOMD-28",
      seriesTicker: "KXPRESNOMD",
      yesPrice: 0.12,
      resolutionSource: "Democratic Party",
    });
  });

  test("derives a series ticker from an event ticker", () => {
    expect(kalshiSeriesTickerFromEvent("KXPRESNOMD-28")).toBe("KXPRESNOMD");
    expect(kalshiSeriesTickerFromEvent("KXHIGHNY-26AUG19")).toBe("KXHIGHNY");
    expect(kalshiSeriesTickerFromEvent("KXFED")).toBe("KXFED");
  });
});

describe("hosted Kalshi catalog 429 fallback", () => {
  test("loads Adjacent Kalshi markets when venue event lists are rate-limited", async () => {
    const urls: string[] = [];
    setHttpFetchTransport(async (url) => {
      urls.push(url);
      if (url.includes("/trade-api/v2/events")) {
        return new Response(JSON.stringify({
          error: { code: "too_many_requests", message: "too many requests" },
        }), { status: 429, headers: { "content-type": "application/json" } });
      }
      if (url.includes("api.adjacent.markets") && url.includes("platform=kalshi")) {
        return new Response(JSON.stringify({
          data: [{
            ticker: "KXMAYORLA-26-KBAS",
            question: "Who will win Los Angeles Mayoral Election?",
            probability: 65,
            volume_24h: 8071,
            event_ticker: "KXMAYORLA-26",
            status: "active",
            category: "Elections",
            link: "https://kalshi.com/markets/kxmayorla",
          }],
          meta: { total: 1, page: 1, per_page: 100, total_pages: 1, has_next: false },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    });

    const markets = await loadKalshiCatalog("", "all", "top", { force: true });
    expect(markets.map((market) => market.marketId)).toEqual(["KXMAYORLA-26-KBAS"]);
    expect(markets[0]?.yesPrice).toBe(0.65);
    expect(urls.some((url) => url.includes("api.adjacent.markets"))).toBe(true);
  });

  test("resolves a ticker through Adjacent when Kalshi market GET is rate-limited", async () => {
    setHttpFetchTransport(async (url) => {
      if (url.includes("/trade-api/v2/")) {
        return new Response(JSON.stringify({
          error: { code: "too_many_requests", message: "too many requests" },
        }), { status: 429, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/public/markets/kalshi:KXPRESNOMD-28-REMA")) {
        return new Response(JSON.stringify({
          ticker: "KXPRESNOMD-28-REMA",
          question: "2028 Democratic presidential nominee",
          description: "Rahm Emanuel",
          probability: 12,
          event_ticker: "KXPRESNOMD-28",
          status: "active",
          category: "Elections",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    });

    const summary = await resolveKalshiMarketByTicker("KXPRESNOMD-28-REMA");
    expect(summary?.marketId).toBe("KXPRESNOMD-28-REMA");
    expect(summary?.yesPrice).toBe(0.12);
  });

  test("loads Adjacent price history when Kalshi candlesticks are rate-limited", async () => {
    setHttpFetchTransport(async (url) => {
      if (url.includes("/trade-api/v2/")) {
        return new Response(JSON.stringify({
          error: { code: "too_many_requests", message: "too many requests" },
        }), { status: 429, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/public/markets/kalshi:KXMAYORLA-26-KBAS/prices")) {
        return new Response(JSON.stringify({
          data: [
            { timestamp: "2026-08-18T04:00:00Z", price: 64 },
            { timestamp: "2026-08-19T11:33:00Z", price: 65 },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    });

    const points = await loadKalshiHistory({
      key: "kalshi:KXMAYORLA-26-KBAS",
      venue: "kalshi",
      marketId: "KXMAYORLA-26-KBAS",
      title: "Who will win Los Angeles Mayoral Election?",
      marketLabel: "Karen Bass",
      eventLabel: "Who will win Los Angeles Mayoral Election?",
      eventTicker: "KXMAYORLA-26",
      seriesTicker: "KXMAYORLA",
      status: "open",
      url: "https://kalshi.com/markets/kxmayorla",
      description: "",
      endsAt: null,
      updatedAt: null,
      createdAt: null,
      yesPrice: 0.65,
      noPrice: 0.35,
      yesBid: null,
      yesAsk: null,
      noBid: null,
      noAsk: null,
      spread: null,
      lastTradePrice: 0.65,
      volume24h: 8071,
      volume24hUnit: "usd",
      totalVolume: null,
      totalVolumeUnit: "usd",
      openInterest: null,
      openInterestUnit: "usd",
      liquidity: null,
      liquidityUnit: "usd",
    }, "ALL");

    expect(points).toHaveLength(2);
    expect(points[1]?.close).toBe(0.65);
  });
});
