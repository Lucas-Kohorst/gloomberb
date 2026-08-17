import { describe, expect, test } from "bun:test";
import {
  formatPredictionSeriesExpression,
  looksLikePredictionMarketQuery,
  resolveAdjacentIndexQuery,
  resolvePredictionSeriesQuery,
} from "./prediction-series";

describe("prediction-market NL → series expression", () => {
  test("maps Adjacent index phrases onto ADJ:indexId", () => {
    expect(resolveAdjacentIndexQuery("adjacent red index")).toEqual({
      kind: "adjacent-index",
      indexId: "red",
      label: "RED Index",
    });
    expect(resolveAdjacentIndexQuery("blue index")).toEqual({
      kind: "adjacent-index",
      indexId: "blue",
      label: "BLUE Index",
    });
    expect(resolveAdjacentIndexQuery("RED-TR")).toEqual({
      kind: "adjacent-index",
      indexId: "red-tr",
      label: "RED Total Return",
    });
    expect(formatPredictionSeriesExpression(resolveAdjacentIndexQuery("adjacent red")!))
      .toBe("ADJ:red");
  });

  test("does not treat a bare color word as an Adjacent index", () => {
    expect(resolveAdjacentIndexQuery("red")).toBeNull();
  });

  test("maps a Kalshi search hit onto KALSHI:ticker", () => {
    const expression = resolvePredictionSeriesQuery("trump kalshi", [
      {
        venue: "kalshi",
        marketId: "KXPRESPERSON",
        title: "Will Trump win the presidential election?",
      },
      {
        venue: "polymarket",
        marketId: "trump-win-2028",
        title: "Will Trump win?",
      },
    ]);
    expect(expression).toEqual({
      kind: "prediction-market",
      venue: "kalshi",
      marketId: "KXPRESPERSON",
      label: "Will Trump win the presidential election?",
    });
    expect(formatPredictionSeriesExpression(expression!)).toBe("KALSHI:KXPRESPERSON");
  });

  test("maps a Polymarket Fed-cut query onto POLY:marketId", () => {
    const expression = resolvePredictionSeriesQuery("will fed cut polymarket", [
      {
        venue: "polymarket",
        marketId: "fed-cut-september",
        title: "Will the Fed cut rates in September?",
      },
      {
        venue: "kalshi",
        marketId: "KXFED-25SEP",
        title: "Fed cuts in September",
      },
    ]);
    expect(expression).toEqual({
      kind: "prediction-market",
      venue: "polymarket",
      marketId: "fed-cut-september",
      label: "Will the Fed cut rates in September?",
    });
    expect(formatPredictionSeriesExpression(expression!)).toBe("POLY:fed-cut-september");
  });

  test("prefers an Adjacent index over market hits when the query is about the index", () => {
    expect(resolvePredictionSeriesQuery("adjacent red index", [
      { venue: "kalshi", marketId: "RED-MKT", title: "Red something" },
    ])).toMatchObject({ kind: "adjacent-index", indexId: "red" });
  });

  test("looksLikePredictionMarketQuery gates live search and command-bar rows", () => {
    expect(looksLikePredictionMarketQuery("trump kalshi")).toBe(true);
    expect(looksLikePredictionMarketQuery("will fed cut polymarket")).toBe(true);
    expect(looksLikePredictionMarketQuery("adjacent red index")).toBe(true);
    expect(looksLikePredictionMarketQuery("KALSHI:KXPRES")).toBe(true);
    expect(looksLikePredictionMarketQuery("AAPL revenue")).toBe(false);
    expect(looksLikePredictionMarketQuery("gold")).toBe(false);
  });
});
