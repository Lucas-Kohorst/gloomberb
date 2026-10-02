import { describe, expect, test } from "bun:test";
import {
  adjacentCatalogHaystack,
  matchAdjacentIndices,
  matchAdjacentRates,
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

  test("team queries reach NTI rate rows through the composed name", () => {
    const rates = [
      rate({ rate_id: "nti_buf_win_27", name: "Win total 11.5+ 2027" }),
      rate({ rate_id: "nti_ari_conf_27", name: "Conference 2027" }),
      rate({ rate_id: "nti_pit_div_26", name: "Division 2026" }),
    ];
    expect(matchAdjacentRates("cardinals", rates).map((row) => row.rate_id)).toEqual(["nti_ari_conf_27"]);
    expect(matchAdjacentRates("arizona", rates).map((row) => row.rate_id)).toEqual(["nti_ari_conf_27"]);
    expect(matchAdjacentRates("steelers", rates).map((row) => row.rate_id)).toEqual(["nti_pit_div_26"]);
    expect(matchAdjacentRates("pittsburgh", rates).map((row) => row.rate_id)).toEqual(["nti_pit_div_26"]);
  });
});

describe("pickAdjacentCatalogOpen", () => {
  const catalogs = {
    indices: [
      index({ index_id: "red", ticker: "RED", name: "RED Index" }),
      index({ index_id: "buf_nti", ticker: "BUFNTI", name: "NFL Team Index: Buffalo" }),
      index({ index_id: "hou_nti", ticker: "HOUNTI", name: "NFL Team Index: Houston" }),
    ],
    rates: [rate({ rate_id: "house", name: "House" })],
  };

  test("opens the indices list when the query is empty", () => {
    expect(pickAdjacentCatalogOpen("", catalogs)).toEqual({ templateId: "adjacent-indices-pane" });
  });

  test("exact index ticker opens ADI", () => {
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

  test("NTI rates open from the raw name and the composed name", () => {
    const withNti = {
      ...catalogs,
      rates: [
        rate({ rate_id: "house", name: "House" }),
        rate({ rate_id: "nti_ari_conf_27", name: "Conference 2027" }),
      ],
    };
    expect(pickAdjacentCatalogOpen("conference 2027", withNti)).toEqual({
      templateId: "adjacent-rates-pane",
      arg: "nti_ari_conf_27",
    });
    expect(pickAdjacentCatalogOpen("Arizona Cardinals · Conference 2027", withNti)).toEqual({
      templateId: "adjacent-rates-pane",
      arg: "nti_ari_conf_27",
    });
  });

  test("multi-token index nickname opens ADI", () => {
    expect(pickAdjacentCatalogOpen("buffalo bills", catalogs)).toEqual({
      templateId: "adjacent-indices-pane",
      arg: "BUFNTI",
    });
  });

  test("single-token index nickname opens ADI", () => {
    expect(pickAdjacentCatalogOpen("houston", catalogs)).toEqual({
      templateId: "adjacent-indices-pane",
      arg: "HOUNTI",
    });
  });

  test("unmatched queries open the indices list with the query", () => {
    expect(pickAdjacentCatalogOpen("election", catalogs)).toEqual({
      templateId: "adjacent-indices-pane",
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
