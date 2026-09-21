import { describe, expect, test } from "bun:test";
import {
  adjacentCatalogHaystack,
  matchAdjacentIndices,
  pickAdjacentCatalogOpen,
  scoreAdjacentCatalogMatch,
} from "./command-bar-search";
import { normalizeAdjacentMarket } from "./normalize";
import type { AdjacentIndex, AdjacentMarket, AdjacentRate } from "./types";

function index(overrides: Partial<AdjacentIndex> & Pick<AdjacentIndex, "index_id" | "name">): AdjacentIndex {
  return {
    ticker: overrides.ticker ?? overrides.index_id.toUpperCase(),
    latest_price: 100,
    ...overrides,
  };
}

function rate(overrides: Partial<AdjacentRate> & Pick<AdjacentRate, "rate_id" | "name">): AdjacentRate {
  return {
    latest_price: 50,
    ...overrides,
  };
}

function market(overrides: Partial<AdjacentMarket> & Pick<AdjacentMarket, "id" | "title">): AdjacentMarket {
  return {
    platform: "kalshi",
    status: "active",
    yes_price: 41,
    no_price: 59,
    volume_24h: 1000,
    open_interest: 200,
    ...overrides,
  };
}

describe("adjacent command-bar catalog search", () => {
  test("buffalo bills hits BUFNTI via the city and Bills nickname", () => {
    const haystack = adjacentCatalogHaystack({
      ticker: "BUFNTI",
      name: "NFL Team Index: Buffalo",
      id: "buf_nti",
    });
    expect(haystack.toLowerCase()).toContain("bills");
    expect(scoreAdjacentCatalogMatch("buffalo bills", haystack)).toBeGreaterThan(0);
    expect(scoreAdjacentCatalogMatch("bufnti", haystack)).toBeGreaterThan(0);

    const hits = matchAdjacentIndices("buffalo bills", [
      index({ index_id: "hou_nti", ticker: "HOUNTI", name: "NFL Team Index: Houston" }),
      index({ index_id: "buf_nti", ticker: "BUFNTI", name: "NFL Team Index: Buffalo" }),
      index({ index_id: "red", ticker: "RED", name: "RED Index" }),
    ]);
    expect(hits.map((row) => row.ticker)).toEqual(["BUFNTI"]);
  });

  test("single token houston still matches Houston", () => {
    const hits = matchAdjacentIndices("houston", [
      index({ index_id: "hou_nti", ticker: "HOUNTI", name: "NFL Team Index: Houston" }),
      index({ index_id: "buf_nti", ticker: "BUFNTI", name: "NFL Team Index: Buffalo" }),
    ]);
    expect(hits.map((row) => row.ticker)).toEqual(["HOUNTI"]);
  });

  test("AND search drops indices that miss a token", () => {
    const hits = matchAdjacentIndices("houston bills", [
      index({ index_id: "hou_nti", ticker: "HOUNTI", name: "NFL Team Index: Houston" }),
      index({ index_id: "buf_nti", ticker: "BUFNTI", name: "NFL Team Index: Buffalo" }),
    ]);
    expect(hits).toEqual([]);
  });
});

describe("pickAdjacentCatalogOpen", () => {
  const catalogs = {
    indices: [
      index({ index_id: "red", ticker: "RED", name: "RED Index" }),
      index({ index_id: "buf_nti", ticker: "BUFNTI", name: "NFL Team Index: Buffalo" }),
    ],
    rates: [rate({ rate_id: "house", name: "House" })],
    markets: [market({ id: "kalshi:KXPRES", title: "Who will win the election?", ticker: "KXPRES" })],
  };

  test("opens the markets list when the query is empty", () => {
    expect(pickAdjacentCatalogOpen("", catalogs)).toEqual({ templateId: "adjacent-markets-pane" });
  });

  test("exact index ticker opens ADI, not markets", () => {
    expect(pickAdjacentCatalogOpen("RED", catalogs)).toEqual({
      templateId: "adjacent-indices-pane",
      arg: "RED",
    });
  });

  test("exact rate id opens ADR", () => {
    expect(pickAdjacentCatalogOpen("house", catalogs)).toEqual({
      templateId: "adjacent-rates-pane",
      arg: "house",
    });
  });

  test("multi-token index nickname opens ADI even when markets exist", () => {
    expect(pickAdjacentCatalogOpen("buffalo bills", catalogs)).toEqual({
      templateId: "adjacent-indices-pane",
      arg: "BUFNTI",
    });
  });

  test("generic market queries open the Adjacent markets list", () => {
    expect(pickAdjacentCatalogOpen("election", catalogs)).toEqual({
      templateId: "adjacent-markets-pane",
      arg: "election",
    });
  });
});

describe("normalizeAdjacentMarket catalog rows", () => {
  test("keeps identity fields and drops venue pricing", () => {
    const row = normalizeAdjacentMarket(market({
      id: "kalshi:KXPRES",
      ticker: "KXPRES",
      title: "Who will win the election?",
      url: "https://kalshi.com/markets/kxpres",
    }));
    expect(row).toEqual({
      id: "kalshi:KXPRES",
      ticker: "KXPRES",
      title: "Who will win the election?",
      platform: "kalshi",
      status: "active",
      endsAt: null,
      url: "https://kalshi.com/markets/kxpres",
      category: undefined,
      subtitle: undefined,
      description: undefined,
    });
    expect(row).not.toHaveProperty("yes_price");
    expect(row).not.toHaveProperty("volume_24h");
    expect(row).not.toHaveProperty("open_interest");
  });
});
