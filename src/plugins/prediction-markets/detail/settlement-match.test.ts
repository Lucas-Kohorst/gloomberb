import { describe, expect, test } from "bun:test";
import { matchSettlementSeries } from "./settlement-match";
import type { PredictionMarketSummary } from "../types";

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

describe("prediction market settlement series matching", () => {
  test("maps a Kalshi weather high market onto WX and NWS series", () => {
    const result = matchSettlementSeries(summary({
      venue: "kalshi",
      marketId: "KXHIGHLAX-26AUG19-B82.5",
      eventTicker: "KXHIGHLAX-26AUG19",
      seriesTicker: "KXHIGHLAX",
      category: "Climate and Weather",
      title: "Will the high temperature in Los Angeles be above 82.5°F on Aug 19, 2026?",
      resolutionSource: "The Weather Company",
      rulesPrimary:
        "This market resolves to The Weather Company Climatological Report (CLILAX) daily maximum temperature.",
    }));
    const expressions = result.series.map((row) => row.expression);
    expect(expressions).toContain("WX:LAX:high");
    expect(expressions).toContain("NWS:KLAX:high");
    expect(result.sourceLabel).toMatch(/Weather Company/i);
  });

  test("maps a CPI market onto FRED CPIAUCSL", () => {
    const result = matchSettlementSeries(summary({
      venue: "kalshi",
      marketId: "KXCPI-26AUG-T0.3",
      seriesTicker: "KXCPI",
      title: "Will CPI increase by more than 0.3% in August 2026?",
      rulesPrimary:
        "Resolves according to the Bureau of Labor Statistics Consumer Price Index for All Urban Consumers (CPI-U), FRED series CPIAUCSL.",
    }));
    expect(result.series.some((row) => row.expression === "FRED:CPIAUCSL")).toBe(true);
    expect(result.sourceLabel).toMatch(/CPI/i);
    expect(result.series.find((row) => row.expression === "FRED:CPIAUCSL")?.reason).toBe("rules");
  });

  test("maps a Bitcoin price market onto BTC-USD:price", () => {
    const result = matchSettlementSeries(summary({
      venue: "polymarket",
      marketId: "btc-100k",
      title: "Will Bitcoin be above $100,000 on December 31, 2026?",
      url: "https://polymarket.com/event/btc-100k",
      rulesPrimary:
        "Settlement uses the BTC-USD reference rate published by CF Benchmarks and the Coinbase Bitcoin price.",
    }));
    expect(result.series.some((row) => row.expression === "BTC-USD:price")).toBe(true);
    expect(result.sourceLabel).toMatch(/Bitcoin/i);
    expect(result.series.find((row) => row.expression === "BTC-USD:price")?.reason).toBe("rules");
  });

  test("maps BLS CPI-U prose onto FRED CPIAUCSL without the series id", () => {
    const result = matchSettlementSeries(summary({
      venue: "kalshi",
      marketId: "KXCPI-26AUG-T0.3",
      seriesTicker: "KXCPI",
      title: "Will CPI increase by more than 0.3% in August 2026?",
      rulesPrimary: "Resolves to BLS CPI-U.",
    }));
    const cpi = result.series.find((row) => row.expression === "FRED:CPIAUCSL");
    expect(cpi).toBeDefined();
    expect(cpi?.reason).toBe("map");
    expect(result.sourceSnippet).toMatch(/BLS CPI-U/i);
  });

  test("does not map an election market onto FRED GDP", () => {
    const result = matchSettlementSeries(summary({
      venue: "polymarket",
      marketId: "pres-2024",
      title: "Will Donald Trump win the 2024 presidential election?",
      category: "Politics",
      rulesPrimary:
        "This market resolves according to the certified Electoral College result and Associated Press projections.",
    }));
    expect(result.series.some((row) => row.expression === "FRED:GDP")).toBe(false);
    expect(result.series.some((row) => row.expression.startsWith("FRED:"))).toBe(false);
    expect(result.sourceSnippet).toMatch(/Electoral College/i);
    expect(result.sourceLabel).toBeTruthy();
  });

  test("keeps a settles-to snippet when no series match", () => {
    const result = matchSettlementSeries(summary({
      venue: "kalshi",
      marketId: "KXSPORT-1",
      title: "Will the Dodgers win the World Series?",
      rulesPrimary: "Resolves to the MLB commissioner certified champion.",
    }));
    expect(result.series).toEqual([]);
    expect(result.sourceSnippet).toMatch(/MLB commissioner/i);
    expect(result.sourceLabel).toMatch(/MLB commissioner/i);
  });
});
