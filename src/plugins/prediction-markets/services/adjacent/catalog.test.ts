import { describe, expect, test } from "bun:test";
import {
  normalizeAdjacentCatalogMarket,
  shouldUseAdjacentCatalog,
} from "./catalog";

describe("adjacent prediction catalog", () => {
  test("uses Adjacent for top and search, not for new or ending", () => {
    expect(shouldUseAdjacentCatalog("top", "")).toBe(true);
    expect(shouldUseAdjacentCatalog("top", "nba")).toBe(true);
    expect(shouldUseAdjacentCatalog("new", "")).toBe(false);
    expect(shouldUseAdjacentCatalog("ending", "")).toBe(false);
    expect(shouldUseAdjacentCatalog("ending", "fed")).toBe(true);
  });

  test("keeps Kalshi 24h volume in contracts instead of last-price dollars", () => {
    const market = normalizeAdjacentCatalogMarket({
      platform: "kalshi",
      ticker: "KXNBA-26-NYK",
      market_id: "kalshi:KXNBA-26-NYK",
      question: "Will the New York win the 2026 Pro Basketball Finals?",
      category: "Sports",
      link: "https://kalshi.com/markets/kxnba/kxnba-26",
      status: "active",
      probability: 37,
      volume_24h: 1_873_462,
      volume_24h_unit: "contracts",
      volume: 42_063_930,
      volume_unit: "contracts",
    });
    expect(market).toMatchObject({
      key: "kalshi:KXNBA-26-NYK",
      venue: "kalshi",
      marketId: "KXNBA-26-NYK",
      volume24h: 1_873_462,
      volume24hUnit: "contracts",
      yesPrice: 0.37,
    });
  });

  test("keeps Polymarket 24h volume in USD", () => {
    const market = normalizeAdjacentCatalogMarket({
      platform: "polymarket",
      ticker: "0xabc",
      market_id: "polymarket:0xabc",
      question: "Will LeBron James win the 2028 US Presidential Election?",
      category: "Politics",
      status: "active",
      probability: 0.6,
      volume_24h: 174_412,
      volume_24h_unit: "usd",
    });
    expect(market?.volume24h).toBe(174_412);
    expect(market?.volume24hUnit).toBe("usd");
    expect(market?.yesPrice).toBe(0.6);
  });
});
