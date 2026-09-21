import { expect, test } from "bun:test";
import { loadPredictionMarketSeries } from "./chart-series";
import type { AdjacentMarket } from "../builtin/adjacent/types";

test("prediction charts prefer venue history and convert probabilities without losing provenance", async () => {
  let adjacentCalls = 0;
  const result = await loadPredictionMarketSeries("kalshi", "MARKET", {
    loadVenue: async () => ({
      venue: "kalshi", marketId: "MARKET", label: "Venue market",
      points: [{ date: new Date("2024-01-01"), close: 0.62 }],
    }),
    adjacent: {
      getMarketPrices: async () => { adjacentCalls++; return { prices: [] }; },
      searchMarkets: async () => { adjacentCalls++; return { markets: [] }; },
    },
  });
  expect(adjacentCalls).toBe(0);
  expect(result).toMatchObject({ label: "Venue market", unit: "%", unitGroup: "probability" });
  expect(result.points).toEqual([{
    date: new Date("2024-01-01"), observedAt: new Date("2024-01-01"), value: 62,
    provenance: { providerId: "kalshi", quality: "reported" },
  }]);
});

test("prediction chart fallback matches a Polymarket event slug from Adjacent URLs", async () => {
  const quiet: AdjacentMarket = {
    id: "quiet-outcome",
    platform: "polymarket",
    title: "0 cuts",
    slug: "will-0-fed-rate-cuts-happen-in-2026",
    url: "https://polymarket.com/event/how-many-fed-rate-cuts-in-2026",
    status: "open",
    yes_price: 12,
    no_price: 88,
    volume_24h: 100,
  };
  const busy: AdjacentMarket = {
    id: "busy-outcome",
    platform: "polymarket",
    title: "1 cut",
    slug: "will-1-fed-rate-cut-happen-in-2026",
    url: "https://polymarket.com/event/how-many-fed-rate-cuts-in-2026",
    status: "open",
    yes_price: 41,
    no_price: 59,
    volume_24h: 16_000,
  };
  const result = await loadPredictionMarketSeries(
    "polymarket",
    "how-many-fed-rate-cuts-in-2026",
    {
      loadVenue: async () => null,
      adjacent: {
        getMarketPrices: async (id) => ({
          prices: id === busy.id
            ? [{ timestamp: "2024-03-01", open: 41, high: 41, low: 41, close: 41 }]
            : [],
        }),
        searchMarkets: async () => ({ markets: [quiet, busy] }),
      },
    },
  );
  expect(result.label).toBe("1 cut");
  expect(result.points[0]?.value).toBe(41);
});

test("prediction chart fallback selects the matching venue before normalizing Adjacent history", async () => {
  const requests: string[] = [];
  const market: AdjacentMarket = {
    id: "adjacent-market", platform: "kalshi", title: "Matched market", slug: "market",
    status: "open", yes_price: 51, no_price: 49,
  };
  const result = await loadPredictionMarketSeries("kalshi", "MARKET", {
    loadVenue: async () => { requests.push("venue"); throw new Error("unavailable"); },
    adjacent: {
      getMarketPrices: async (id) => {
        requests.push(id);
        return { prices: id === market.id ? [
          { timestamp: "invalid", open: 1, high: 1, low: 1, close: 1 },
          { timestamp: "2024-02-01", open: 51, high: 51, low: 51, close: 51 },
        ] : [] };
      },
      searchMarkets: async () => {
        requests.push("search");
        return { markets: [{ ...market, id: "wrong-venue", platform: "polymarket" }, market] };
      },
    },
  });
  expect(requests).toEqual(["venue", "MARKET", "search", "adjacent-market"]);
  expect(result.label).toBe("Matched market");
  expect(result.points).toEqual([{
    date: new Date("2024-02-01"), observedAt: new Date("2024-02-01"), value: 51,
    provenance: { providerId: "adjacent", quality: "reported" },
  }]);
});
