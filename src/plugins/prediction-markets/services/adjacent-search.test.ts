import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { predictionSeriesId } from "../capability";
import {
  parseAdjacentSearchPageCursor,
  searchAdjacentCatalog,
} from "./adjacent-search";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "./fetch";
import { resetHostedAdjacentPathFallback } from "./kalshi/adjacent-catalog";
import { MemoryPersistence } from "../test-helpers";

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const POLY_LIVE = {
  market_id: "polymarket:0x078aeb1eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ticker: "0x078aeb1eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  display_ticker: "will-one-person-dissent-the-october-fed-decision-2026",
  platform: "polymarket",
  question: "Will one person dissent the October Fed decision?",
  link: "https://polymarket.com/event/fed-decision-october-2026",
  status: "active",
  probability: 22,
};

const KALSHI_LIVE = {
  market_id: "kalshi:KXFED-26SEP-T3.00",
  ticker: "KXFED-26SEP-T3.00",
  display_ticker: "KXFED-26SEP-T3.00",
  platform: "kalshi",
  question: "Fed funds rate after September 2026 meeting?",
  link: "https://kalshi.com/markets/kxfed/kxfed-26sep",
  status: "active",
  probability: 41,
};

describe("adjacent catalog search", () => {
  afterEach(() => {
    setHttpFetchTransport(null);
    resetPredictionMarketsPersistence();
    resetHostedAdjacentPathFallback();
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
  });

  test("keeps Kalshi volume, open interest, and close from Adjacent list rows", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    setHttpFetchTransport(async () => json({
      data: [{
        ...KALSHI_LIVE,
        volume_24h: 1013,
        volume: 1046,
        open_interest: 1013,
        end_date: "2026-09-18T05:59:00Z",
      }],
      meta: { has_next: false },
    }));

    const { markets } = await searchAdjacentCatalog({ query: "diesel", venue: "kalshi" });
    expect(markets[0]).toMatchObject({
      marketId: "KXFED-26SEP-T3.00",
      volume24h: 1013,
      totalVolume: 1046,
      openInterest: 1013,
      endsAt: "2026-09-18T05:59:00Z",
    });
  });

  test("fills sparse Adjacent Polymarket stats from Gamma by event slug", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    setHttpFetchTransport(async (url) => {
      if (url.includes("gamma-api.polymarket.com/events?slug=")) {
        return json([{
          id: "101936",
          slug: "fed-decision-october-2026",
          title: "October Fed decision",
          openInterest: 1_600_000,
          volume24hr: 88_000,
          endDate: "2026-10-29T00:00:00Z",
          markets: [{
            id: "908713",
            slug: "will-one-person-dissent-the-october-fed-decision-2026",
            question: POLY_LIVE.question,
            outcomes: ["Yes", "No"],
            outcomePrices: ["0.22", "0.78"],
            clobTokenIds: ["yes-token", "no-token"],
            volume24hr: "88000.5",
            volumeNum: 1_940_000,
            bestBid: 0.21,
            bestAsk: 0.23,
            spread: 0.02,
            conditionId: POLY_LIVE.ticker,
            endDate: "2026-10-29T00:00:00Z",
          }],
        }]);
      }
      return json({ data: [POLY_LIVE], meta: { has_next: false } });
    });

    const { markets } = await searchAdjacentCatalog({ query: "fed", venue: "polymarket" });
    expect(markets[0]?.volume24h).toBe(88000.5);
    expect(markets[0]?.totalVolume).toBe(1_940_000);
    expect(markets[0]?.openInterest).toBe(1_600_000);
    expect(markets[0]?.spread).toBeCloseTo(0.02);
    expect(markets[0]?.yesTokenId).toBe("yes-token");
    expect(markets[0]?.endsAt).toBe("2026-10-29T00:00:00Z");
  });

  test("maps a live Polymarket list row onto a Gamma-resolvable slug and event", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    setHttpFetchTransport(async () => json({ data: [POLY_LIVE], meta: { has_next: false } }));

    const { markets } = await searchAdjacentCatalog({ query: "fed", venue: "polymarket" });
    const market = markets[0];

    expect(market?.marketId).toBe("will-one-person-dissent-the-october-fed-decision-2026");
    expect(market?.conditionId).toBe(POLY_LIVE.ticker);
    expect(market?.eventId).toBe("fed-decision-october-2026");
    expect(predictionSeriesId(market!)).toBe(
      "polymarket/fed-decision-october-2026/will-one-person-dissent-the-october-fed-decision-2026",
    );
  });

  test("derives a Kalshi event ticker from the market ticker when Adjacent omits event_id", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    setHttpFetchTransport(async () => json({ data: [KALSHI_LIVE], meta: { has_next: false } }));

    const { markets } = await searchAdjacentCatalog({ query: "fed", venue: "kalshi" });
    const market = markets[0];

    expect(market?.marketId).toBe("KXFED-26SEP-T3.00");
    expect(market?.eventTicker).toBe("KXFED-26SEP");
    expect(predictionSeriesId(market!)).toBe("kalshi/KXFED-26SEP/KXFED-26SEP-T3.00");
  });

  test("falls back to a meaningful token when Adjacent AND search finds no phrase match", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    const requested: string[] = [];
    setHttpFetchTransport(async (url) => {
      requested.push(url);
      if (url.includes("search=fed+decision")) {
        return json({ data: [], meta: { has_next: false } });
      }
      return json({ data: [KALSHI_LIVE], meta: { has_next: false } });
    });

    const { markets } = await searchAdjacentCatalog({ query: "fed decision", venue: "kalshi" });
    expect(markets[0]?.marketId).toBe("KXFED-26SEP-T3.00");
    expect(requested.some((url) => url.includes("search=fed+decision"))).toBe(true);
    expect(requested.some((url) => url.includes("search=fed"))).toBe(true);
  });

  test("strips a leaked / so pane /diesel searches Adjacent for diesel", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    const requested: string[] = [];
    setHttpFetchTransport(async (url) => {
      requested.push(url);
      return json({
        data: [{
          market_id: "kalshi:KXDIESELMON-26SEP30-T6.60",
          ticker: "KXDIESELMON-26SEP30-T6.60",
          platform: "kalshi",
          question: "Will the U.S. EIA weekly average diesel price be above $6.60?",
          link: "https://kalshi.com/markets/kxdieselmon/kxdieselmon-26sep30",
          status: "active",
          probability: 12,
        }],
        meta: { has_next: false },
      });
    });

    const { markets } = await searchAdjacentCatalog({ query: "/diesel", venue: "kalshi" });
    expect(markets[0]?.marketId).toBe("KXDIESELMON-26SEP30-T6.60");
    expect(requested.some((url) => url.includes("search=diesel"))).toBe(true);
    expect(requested.some((url) => url.includes("search=%2Fdiesel") || url.includes("search=/diesel"))).toBe(false);
  });

  test("strips focused-search ? so pane ? diesel searches Adjacent for diesel", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    const requested: string[] = [];
    setHttpFetchTransport(async (url) => {
      requested.push(url);
      return json({
        data: [{
          market_id: "kalshi:KXDIESELMON-26SEP30-T6.60",
          ticker: "KXDIESELMON-26SEP30-T6.60",
          platform: "kalshi",
          question: "Will the U.S. EIA weekly average diesel price be above $6.60?",
          link: "https://kalshi.com/markets/kxdieselmon/kxdieselmon-26sep30",
          status: "active",
          probability: 12,
        }],
        meta: { has_next: false },
      });
    });

    const { markets } = await searchAdjacentCatalog({ query: "? diesel", venue: "kalshi" });
    expect(markets[0]?.marketId).toBe("KXDIESELMON-26SEP30-T6.60");
    expect(requested.some((url) => url.includes("search=diesel"))).toBe(true);
    expect(requested.some((url) => url.includes("search=%3F") || url.includes("search=?"))).toBe(false);
  });

  test("sends the Adjacent page cursor on load-more", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    const requested: string[] = [];
    setHttpFetchTransport(async (url) => {
      requested.push(url);
      return json({ data: [KALSHI_LIVE], meta: { has_next: true } });
    });

    const page = await searchAdjacentCatalog({
      query: "fed",
      venue: "kalshi",
      page: parseAdjacentSearchPageCursor("page:2"),
    });

    expect(requested[0]).toContain("page=2");
    expect(requested[0]).toContain("search=fed");
    expect(requested[0]).toContain("platform=kalshi");
    expect(page.nextCursor).toBe("page:3");
    expect(page.hasMore).toBe(true);
  });

  test("hosted search uses the feed alias, not /api/data/adjacent", async () => {
    (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED = true;
    attachPredictionMarketsPersistence(new MemoryPersistence());
    const requested: string[] = [];
    const realFetch = globalThis.fetch;
    const realLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://terminal.kohor.st" },
      configurable: true,
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/api/feed/mkt/markets") && url.includes("search=fed")) {
        return json({ data: [KALSHI_LIVE], meta: { has_next: false } });
      }
      throw new Error(`Unexpected hosted search URL ${url}`);
    }) as typeof fetch;

    try {
      const { markets } = await searchAdjacentCatalog({ query: "fed", venue: "kalshi" });
      expect(markets[0]?.marketId).toBe("KXFED-26SEP-T3.00");
      expect(requested.some((url) => url.includes("/api/feed/mkt/markets") && url.includes("search=fed"))).toBe(true);
      expect(requested.some((url) => url.includes("/api/data/adjacent"))).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
      Object.defineProperty(globalThis, "location", {
        value: realLocation,
        configurable: true,
      });
    }
  });
});
