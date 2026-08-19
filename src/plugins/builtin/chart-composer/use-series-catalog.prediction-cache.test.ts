import { afterEach, describe, expect, test } from "bun:test";
import type { PredictionMarketSummary } from "../../prediction-markets/types";
import {
  loadCatalogPredictionHits,
  peekCatalogPredictionHitsError,
  resetCatalogPredictionHitsCache,
} from "./use-series-catalog";

let kalshiCalls = 0;
let polymarketCalls = 0;
let venuesFail = false;

const kalshiHit = {
  marketId: "KXFED",
  venue: "kalshi" as const,
  title: "Will the Fed cut rates?",
  marketLabel: "Yes",
  eventLabel: "Will the Fed cut rates?",
  url: "https://kalshi.com/markets/KXFED",
};

const polymarketHit = {
  marketId: "0xabc",
  venue: "polymarket" as const,
  title: "Will BTC hit 200k?",
  marketLabel: "Yes",
  eventLabel: "Will BTC hit 200k?",
  url: "https://polymarket.com/event/btc",
};

function asSummary(hit: typeof kalshiHit | typeof polymarketHit): PredictionMarketSummary {
  return {
    key: `${hit.venue}:${hit.marketId}`,
    venue: hit.venue,
    marketId: hit.marketId,
    title: hit.title,
    marketLabel: hit.marketLabel,
    eventLabel: hit.eventLabel,
    status: "open",
    url: hit.url,
    description: "",
    endsAt: null,
    updatedAt: null,
    createdAt: null,
    yesPrice: null,
    noPrice: null,
    yesBid: null,
    yesAsk: null,
    noBid: null,
    noAsk: null,
    spread: null,
    lastTradePrice: null,
    volume24h: null,
    volume24hUnit: "usd",
    totalVolume: null,
    totalVolumeUnit: "usd",
    openInterest: null,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
  };
}

const loaders = {
  loadKalshi: async () => {
    kalshiCalls += 1;
    if (venuesFail) throw new Error("kalshi down");
    return [asSummary(kalshiHit)];
  },
  loadPolymarket: async () => {
    polymarketCalls += 1;
    if (venuesFail) throw new Error("poly down");
    return [asSummary(polymarketHit)];
  },
};

describe("catalog prediction hit cache", () => {
  afterEach(() => {
    resetCatalogPredictionHitsCache();
    kalshiCalls = 0;
    polymarketCalls = 0;
    venuesFail = false;
  });

  test("loads venue catalogs once and reuses the in-memory snapshot", async () => {
    const first = await loadCatalogPredictionHits(loaders);
    const second = await loadCatalogPredictionHits(loaders);
    expect(first).toHaveLength(2);
    expect(second).toBe(first);
    expect(kalshiCalls).toBe(1);
    expect(polymarketCalls).toBe(1);
  });

  test("does not cache a total venue failure and records an error", async () => {
    venuesFail = true;
    const first = await loadCatalogPredictionHits(loaders);
    expect(first).toEqual([]);
    expect(peekCatalogPredictionHitsError()).toBe("couldn't load prediction markets");

    venuesFail = false;
    const second = await loadCatalogPredictionHits(loaders);
    expect(second).toHaveLength(2);
    expect(peekCatalogPredictionHitsError()).toBeNull();
    expect(kalshiCalls).toBe(2);
    expect(polymarketCalls).toBe(2);
  });
});
