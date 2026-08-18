import { describe, expect, test } from "bun:test";
import {
  catalogRowsFromPredictionHits,
  filterCatalogRows,
  listStaticCatalogInventory,
} from "./catalog-inventory";

const AAPL = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };

describe("data catalog inventory", () => {
  test("lists security fields, FRED, futures, Adjacent, treasuries, polls, and benchmarks", () => {
    const rows = listStaticCatalogInventory(AAPL);
    const expressions = new Set(rows.map((row) => row.expression));

    expect(expressions.has("AAPL:XNAS:price")).toBe(true);
    expect(expressions.has("AAPL:XNAS:dvd")).toBe(true);
    expect(expressions.has("FRED:CPIAUCSL")).toBe(true);
    expect(expressions.has("FUT:ES")).toBe(true);
    expect(expressions.has("ADJ:red")).toBe(true);
    expect(expressions.has("UST:10Y")).toBe(true);
    expect([...expressions].some((value) => value.startsWith("POLL:"))).toBe(true);
    expect([...expressions].some((value) => value.startsWith("BENCH:"))).toBe(true);
  });

  test("filters by source and search text", () => {
    const rows = listStaticCatalogInventory(AAPL);
    const dividends = filterCatalogRows(rows, "securities", "dvd");
    expect(dividends.some((row) => row.expression.endsWith(":dvd"))).toBe(true);

    const prediction = filterCatalogRows(rows, "prediction", "red");
    expect(prediction.every((row) => (
      row.sourceId === "adjacent" || row.sourceId === "kalshi" || row.sourceId === "polymarket"
    ))).toBe(true);
    expect(prediction.some((row) => row.expression === "ADJ:red")).toBe(true);
  });

  test("maps live prediction hits onto chartable rows with venue URLs", () => {
    const [row] = catalogRowsFromPredictionHits([{
      venue: "kalshi",
      marketId: "KXPRESPERSON",
      title: "Who will be the next president?",
    }]);
    expect(row).toMatchObject({
      expression: "KALSHI:KXPRESPERSON",
      sourceId: "kalshi",
      url: "https://kalshi.com/markets/KXPRESPERSON",
    });
  });
});
