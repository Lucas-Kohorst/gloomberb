import { describe, expect, test } from "bun:test";
import { buildNewsQueryKey } from "../../../news/aggregator";
import type { PredictionMarketSummary } from "../types";
import { buildPredictionNewsQuery } from "./news-query";

function summary(
  overrides: Partial<PredictionMarketSummary> & Pick<PredictionMarketSummary, "venue" | "marketId" | "title">,
): PredictionMarketSummary {
  return {
    key: `${overrides.venue}:${overrides.marketId}`,
    marketLabel: overrides.title,
    eventLabel: overrides.title,
    status: "open",
    url: "",
    description: "",
    endsAt: null,
    updatedAt: null,
    createdAt: null,
    yesPrice: 0.5,
    noPrice: 0.5,
    yesBid: null,
    yesAsk: null,
    noBid: null,
    noAsk: null,
    spread: null,
    lastTradePrice: null,
    volume24h: null,
    volume24hUnit: "usd",
    totalVolume: null,
    totalVolumeUnit: "usd",
    openInterest: null,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
    ...overrides,
  };
}

describe("buildPredictionNewsQuery", () => {
  test("uses DES ticker news for a MicroStrategy settlement match", () => {
    const query = buildPredictionNewsQuery(summary({
      venue: "polymarket",
      marketId: "mstr-2000",
      title: "Will MicroStrategy (MSTR) close above $2,000 by December 31, 2026?",
      eventLabel: "Strategy Inc share price",
      rulesPrimary: "Resolves to the official NASDAQ:MSTR closing price.",
    }));

    expect(query).not.toBeNull();
    expect(query?.feed).toBe("ticker");
    expect(query?.ticker).toBe("MSTR");
    expect(query?.tickerTier).toBe("primary");
    expect(query?.limit).toBe(50);
    expect(query?.tickerRelations).toContain("STRF");
    expect(query?.tickerRelations).toContain("STRC");

    const key = buildNewsQueryKey(query!);
    expect(key.startsWith("ticker|MSTR|")).toBe(true);
    expect(key).toContain("primary");
    expect(key).toContain("strf");
    expect(key).toContain("strc");
  });

  test("returns null for Fed funds and election markets with no equity ticker", () => {
    expect(buildPredictionNewsQuery(summary({
      venue: "kalshi",
      marketId: "KXFED-26SEP-T4.25",
      seriesTicker: "KXFED",
      title: "Will the Fed cut rates at the September FOMC meeting?",
      resolutionSource: "The FOMC's statement after its meeting scheduled for September 16, 2026.",
      rulesPrimary:
        "The resolution source for this market is the FOMC's statement after its meeting scheduled for September 16-17, 2026.",
    }))).toBeNull();

    expect(buildPredictionNewsQuery(summary({
      venue: "polymarket",
      marketId: "pres-2024",
      title: "Will Donald Trump win the 2024 presidential election?",
      category: "Politics",
      rulesPrimary:
        "This market resolves according to the certified Electoral College result and Associated Press projections.",
    }))).toBeNull();
  });
});
