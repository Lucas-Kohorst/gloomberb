import { describe, expect, test } from "bun:test";
import { isPlausibleTickerQuery, normalizeQuickAddQuery } from "./resolution";

describe("portfolio quick-add query parsing", () => {
  test("accepts exchange-qualified and Bloomberg ticker queries", () => {
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("NYSE:BLK"))).toBe(true);
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("BLK:NYSE"))).toBe(true);
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("NASDAQ:GLXY"))).toBe(true);
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("blk us"))).toBe(true);
    expect(isPlausibleTickerQuery(normalizeQuickAddQuery("UBER"))).toBe(true);
  });
});
