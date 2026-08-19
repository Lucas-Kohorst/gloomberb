import { afterEach, describe, expect, mock, test } from "bun:test";

let kalshiCalls = 0;
let polymarketCalls = 0;

mock.module("../../prediction-markets/services/kalshi/adapter", () => ({
  loadKalshiCatalog: async () => {
    kalshiCalls += 1;
    return [{
      marketId: "KXFED",
      venue: "kalshi",
      title: "Will the Fed cut rates?",
      marketLabel: "Yes",
      eventLabel: "Will the Fed cut rates?",
      url: "https://kalshi.com/markets/KXFED",
    }];
  },
}));

mock.module("../../prediction-markets/services/polymarket/adapter", () => ({
  loadPolymarketCatalog: async () => {
    polymarketCalls += 1;
    return [{
      marketId: "0xabc",
      venue: "polymarket",
      title: "Will BTC hit 200k?",
      marketLabel: "Yes",
      eventLabel: "Will BTC hit 200k?",
      url: "https://polymarket.com/event/btc",
    }];
  },
}));

const {
  loadCatalogPredictionHits,
  resetCatalogPredictionHitsCache,
} = await import("./use-series-catalog");

describe("catalog prediction hit cache", () => {
  afterEach(() => {
    resetCatalogPredictionHitsCache();
    kalshiCalls = 0;
    polymarketCalls = 0;
  });

  test("loads venue catalogs once and reuses the in-memory snapshot", async () => {
    const first = await loadCatalogPredictionHits();
    const second = await loadCatalogPredictionHits();
    expect(first).toHaveLength(2);
    expect(second).toBe(first);
    expect(kalshiCalls).toBe(1);
    expect(polymarketCalls).toBe(1);
  });
});
