import { describe, expect, test } from "bun:test";
import {
  adjacentCatalogHaystack,
  matchAdjacentIndices,
  scoreAdjacentCatalogMatch,
} from "./command-bar-search";
import type { AdjacentIndex } from "./types";

function index(overrides: Partial<AdjacentIndex> & Pick<AdjacentIndex, "index_id" | "name">): AdjacentIndex {
  return {
    ticker: overrides.ticker ?? overrides.index_id.toUpperCase(),
    latest_price: 100,
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

  test("does not require every query token when one distinctive city matches", () => {
    const hits = matchAdjacentIndices("houston", [
      index({ index_id: "hou_nti", ticker: "HOUNTI", name: "NFL Team Index: Houston" }),
      index({ index_id: "buf_nti", ticker: "BUFNTI", name: "NFL Team Index: Buffalo" }),
    ]);
    expect(hits.map((row) => row.ticker)).toEqual(["HOUNTI"]);
  });
});
