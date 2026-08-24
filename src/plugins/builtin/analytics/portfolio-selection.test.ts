import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import type { TickerRecord } from "../../../types/ticker";
import {
  collectionMembers,
  collectionUsesEqualWeight,
  listAnalyticsCollections,
  resolveAnalyticsCollection,
  resolveTemplateCollectionId,
} from "./portfolio-selection";

function ticker(symbol: string, extras: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...extras,
    },
  };
}

describe("resolveAnalyticsCollection", () => {
  const config = createDefaultConfig("/tmp/gloomberb-analytics-collections");

  test("resolves a portfolio id", () => {
    expect(resolveAnalyticsCollection(config, "main")).toEqual({
      kind: "portfolio",
      id: "main",
      name: "Main Portfolio",
    });
  });

  test("resolves a watchlist id", () => {
    expect(resolveAnalyticsCollection(config, "watchlist")).toEqual({
      kind: "watchlist",
      id: "watchlist",
      name: "Watchlist",
    });
  });

  test("returns null for an unknown id", () => {
    expect(resolveAnalyticsCollection(config, "missing")).toBeNull();
    expect(resolveAnalyticsCollection(config, null)).toBeNull();
  });

  test("lists portfolios first, then watchlists", () => {
    const ids = listAnalyticsCollections(config).map((entry) => entry.id);
    expect(ids[0]).toBe("main");
    expect(ids).toContain("watchlist");
    expect(ids.indexOf("main")).toBeLessThan(ids.indexOf("watchlist"));
  });

  test("falls back to the first portfolio, then the first watchlist", () => {
    expect(resolveTemplateCollectionId(config, "watchlist")).toBe("watchlist");
    expect(resolveTemplateCollectionId(config, "missing")).toBe("main");
    expect(resolveTemplateCollectionId({ portfolios: [], watchlists: config.watchlists }, null)).toBe("watchlist");
    expect(resolveTemplateCollectionId({ portfolios: [], watchlists: [] }, null)).toBeNull();
  });

  test("includes watchlist members without positions and equal-weights them", () => {
    const collection = resolveAnalyticsCollection(config, "watchlist")!;
    const tickers = new Map([
      ["AAPL", ticker("AAPL", { watchlists: ["watchlist"], sector: "Technology" })],
      ["JNJ", ticker("JNJ", { watchlists: ["watchlist"], sector: "Healthcare" })],
      ["MSFT", ticker("MSFT", { portfolios: ["main"], positions: [{ portfolio: "main", shares: 1, avgCost: 1, broker: "manual" }] })],
    ]);
    expect(collectionMembers(collection, tickers).map((entry) => entry.metadata.ticker)).toEqual(["AAPL", "JNJ"]);
    expect(collectionUsesEqualWeight(collection)).toBe(true);
  });
});
