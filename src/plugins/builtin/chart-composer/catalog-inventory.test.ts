import { describe, expect, test } from "bun:test";
import {
  catalogRowsFromAaModels,
  catalogRowsFromPredictionHits,
  filterCatalogRows,
  listStaticCatalogInventory,
} from "./catalog-inventory";
import type { AaModelRow } from "../llm-stats/types";

const AAPL = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };
const MSFT = { symbol: "MSFT", exchange: "NASDAQ", name: "Microsoft Corp." };
const OPTION = {
  symbol: "AAPL 260618C00200000",
  exchange: "CBOE",
  name: "AAPL Jun18'26 200 Call",
  assetCategory: "OPT",
};

function language(overrides: Partial<AaModelRow> = {}): AaModelRow {
  return {
    id: "gpt-4o",
    slug: "gpt-4o",
    name: "GPT-4o",
    creator: "OpenAI",
    creatorSlug: "openai",
    family: "language",
    category: "language",
    releaseDate: "2024-05-13",
    url: "https://artificialanalysis.ai/models/gpt-4o",
    intelligence: 40,
    coding: 38,
    agentic: 36,
    speed: 80,
    ttftSeconds: 0.4,
    e2eSeconds: 2.1,
    inputPrice: 2.5,
    outputPrice: 10,
    elo: null,
    ci95: null,
    bba: null,
    fdb: null,
    tau: null,
    wer: null,
    ...overrides,
  };
}

describe("data catalog inventory", () => {
  test("maps source to the provider and kind to the series class", () => {
    const rows = listStaticCatalogInventory([AAPL]);
    const byExpression = new Map(rows.map((row) => [row.expression, row]));

    expect(byExpression.get("AAPL:XNAS:price")).toMatchObject({ source: "Yahoo", kind: "Market" });
    expect(byExpression.get("AAPL:XNAS:dvd")).toMatchObject({ source: "Yahoo", kind: "Dividends" });
    expect(byExpression.get("FRED:CPIAUCSL")).toMatchObject({ source: "FRED", kind: "Economic" });
    expect(byExpression.get("UST:10Y")).toMatchObject({ source: "FRED", kind: "Treasury" });
    expect(byExpression.get("ADJ:red")).toMatchObject({ source: "Adjacent", kind: "Index" });
    expect(byExpression.get("FUT:ES")).toMatchObject({ source: "Yahoo" });
    expect(rows.some((row) => row.source === "VoteHub" && row.kind === "Poll")).toBe(true);
    expect(rows.some((row) => row.source === "Artificial Analysis" && row.kind === "Benchmark")).toBe(true);
  });

  test("builds security fields from every instrument in the universe", () => {
    const rows = listStaticCatalogInventory([AAPL, MSFT]);
    const expressions = new Set(rows.map((row) => row.expression));
    expect(expressions.has("AAPL:XNAS:price")).toBe(true);
    expect(expressions.has("MSFT:XNAS:price")).toBe(true);
    expect(expressions.has("AAPL:XNAS:dvd")).toBe(true);
    expect(expressions.has("MSFT:XNAS:dvd")).toBe(true);
  });

  test("option contracts emit Options kind and stay in the securities filter", () => {
    const parsed = listStaticCatalogInventory([{
      symbol: "AAPL 260618C00200000",
      name: "AAPL call",
    }]);
    expect(parsed.some((row) => row.kind === "Options")).toBe(true);

    const rows = listStaticCatalogInventory([AAPL, OPTION]);
    const optionRows = rows.filter((row) => row.kind === "Options");
    expect(optionRows.length).toBeGreaterThan(0);
    expect(optionRows.every((row) => row.source === "Yahoo" && row.sourceId === "security")).toBe(true);

    const securities = filterCatalogRows(rows, "securities", "");
    expect(securities.some((row) => row.kind === "Options")).toBe(true);
    expect(securities.some((row) => row.kind === "Market")).toBe(true);
  });

  test("maps AA models onto BENCH rows with artificialanalysis.ai attribution", () => {
    const rows = catalogRowsFromAaModels([language({ coding: null })]);
    expect(rows.some((row) => row.expression === "BENCH:gpt-4o:intelligence")).toBe(true);
    expect(rows.every((row) => row.source === "Artificial Analysis")).toBe(true);
    expect(rows.every((row) => row.kind === "Benchmark")).toBe(true);
    expect(rows.every((row) => row.url?.includes("artificialanalysis.ai"))).toBe(true);
    expect(rows.every((row) => row.searchText.includes("artificialanalysis.ai"))).toBe(true);
    expect(rows.some((row) => row.expression === "BENCH:gpt-4o:coding")).toBe(false);
  });

  test("ai filter is benchmarks; other is polls; securities includes options", () => {
    const rows = listStaticCatalogInventory([AAPL, OPTION]);
    const ai = filterCatalogRows(rows, "ai", "");
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((row) => row.sourceId === "benchmark")).toBe(true);

    const other = filterCatalogRows(rows, "other", "");
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((row) => row.sourceId === "poll")).toBe(true);

    const securities = filterCatalogRows(rows, "securities", "");
    expect(securities.every((row) => row.sourceId === "security")).toBe(true);
    expect(securities.some((row) => row.kind === "Options")).toBe(true);
  });

  test("filters by source and search text", () => {
    const rows = listStaticCatalogInventory([AAPL]);
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
      kind: "Prediction",
      source: "Kalshi",
      url: "https://kalshi.com/markets/KXPRESPERSON",
    });
  });
});
