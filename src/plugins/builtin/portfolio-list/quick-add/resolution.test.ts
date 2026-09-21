import { describe, expect, test } from "bun:test";
import { isPlausibleAssetQuery, isPlausibleTickerQuery, normalizeQuickAddQuery, resolveQuickAddValidation } from "./resolution";

describe("portfolio quick-add query parsing", () => {
  test("accepts exchange-qualified and Bloomberg ticker queries", () => {
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("NYSE:BLK"))).toBe(true);
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("BLK:NYSE"))).toBe(true);
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("NASDAQ:GLXY"))).toBe(true);
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("blk us"))).toBe(true);
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("UBER"))).toBe(true);
  });

  test("asset queries allow names that are not bare symbols", () => {
    expect(isPlausibleAssetQuery("buffalo bills")).toBe(true);
    expect(isPlausibleAssetQuery("")).toBe(false);
  });
});

describe("watchlist quick-add adjacent indices", () => {
  test("watchlist quick-add accepts an Adjacent index ticker", async () => {
    const result = await resolveQuickAddValidation({
      query: "ARINTI",
      collectionId: "watchlist",
      collectionKind: "watchlist",
      tickers: new Map(),
      financials: new Map(),
      lookupAdjacentIndex: async () => ({ index_id: "ari_nti", ticker: "ARINTI", name: "NFL Team Index: Arizona", latest_price: 1 }),
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.ticker?.metadata.assetCategory).toBe("ADJACENT_INDEX");
  });
});
