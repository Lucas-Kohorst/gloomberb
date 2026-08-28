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
    const wx = result.series.find((row) => row.expression === "WX:LAX:high")!;
    expect(wx.label).toBe("LAX · Daily high");
    expect(wx.description).toMatch(/Weather Company CLILAX.*Los Angeles/i);
    const nws = result.series.find((row) => row.expression === "NWS:KLAX:high")!;
    expect(nws.description).toMatch(/NWS KLAX.*Daily Climate Report/i);
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

  test("maps an FOMC decision onto Fed funds and 10Y yield series", () => {
    const result = matchSettlementSeries(summary({
      venue: "kalshi",
      marketId: "KXFED-26SEP-T4.25",
      seriesTicker: "KXFED",
      title: "Will the Fed cut rates at the September FOMC meeting?",
      resolutionSource: "The FOMC's statement after its meeting scheduled for September 16, 2026.",
      rulesPrimary:
        "The resolution source for this market is the FOMC's statement after its meeting scheduled for September 16-17, 2026.",
    }));
    const expressions = result.series.map((row) => row.expression);
    expect(expressions).toContain("FRED:FEDFUNDS");
    expect(expressions).toContain("FRED:DFEDTARU");
    expect(expressions).toContain("UST:10Y");
    expect(result.sourceSnippet).toMatch(/FOMC/i);
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

  test("maps a Polymarket weather high market onto WX and NWS series", () => {
    const result = matchSettlementSeries(summary({
      venue: "polymarket",
      marketId: "nyc-high-80",
      title: "Will the high temperature in New York City be above 80°F on August 19?",
      category: "Climate and Weather",
      rulesPrimary:
        "This market resolves based on the daily maximum temperature for New York City " +
        "as reported by The Weather Company.",
      resolutionSource: "The Weather Company",
    }));
    const expressions = result.series.map((row) => row.expression);
    expect(expressions).toContain("WX:NYC:high");
    expect(expressions).toContain("NWS:KNYC:high");
    expect(result.sourceLabel).toMatch(/Weather Company/i);
    const wx = result.series.find((row) => row.expression === "WX:NYC:high")!;
    expect(wx.reason).toBe("map");
    expect(wx.description).toMatch(/Weather Company CLINYC.*New York/i);
  });

  test("maps a Polymarket weather low market by title without an explicit source", () => {
    const result = matchSettlementSeries(summary({
      venue: "polymarket",
      marketId: "chi-low-30",
      title: "Will the daily low temperature in Chicago drop below 30°F?",
      category: "Climate",
      rulesPrimary: "Resolves to the minimum temperature recorded for Chicago.",
    }));
    const expressions = result.series.map((row) => row.expression);
    expect(expressions).toContain("WX:MDW:low");
    expect(expressions).toContain("NWS:KMDW:low");
    const wx = result.series.find((row) => row.expression === "WX:MDW:low")!;
    expect(wx.reason).toBe("alias");
  });

  test("maps a Polymarket precipitation market onto WX precip series", () => {
    const result = matchSettlementSeries(summary({
      venue: "polymarket",
      marketId: "mia-rain",
      title: "Will precipitation in Miami exceed 2 inches on August 19?",
      category: "Climate and Weather",
      rulesPrimary: "Resolves based on rainfall reported by the National Weather Service.",
      resolutionSource: "National Weather Service",
    }));
    const expressions = result.series.map((row) => row.expression);
    expect(expressions).toContain("WX:MIA:precip");
    // NWS CLI print is only for high/low, not precip.
    expect(expressions).not.toContain("NWS:KMIA:precip");
  });

  test("maps Polymarket slug-style NYC weather titles from weather.gov rules", () => {
    const result = matchSettlementSeries(summary({
      venue: "polymarket",
      marketId: "highest-temperature-in-nyc-on-august-27-2026",
      title: "highest-temperature-in-nyc-on-august-27-2026-69forbelow",
      category: "Weather",
      rulesPrimary: "This market resolves to the highest temperature recorded by NOAA.",
      resolutionSource: "https://www.weather.gov/wrh/timeseries?site=klga",
    }));
    const expressions = result.series.map((row) => row.expression);
    expect(expressions).toContain("WX:NYC:high");
    expect(expressions).toContain("NWS:KNYC:high");
  });

  test("does not map a politics market that mentions a weather city onto weather feeds", () => {
    const result = matchSettlementSeries(summary({
      venue: "polymarket",
      marketId: "pres-nyc",
      title: "Will the Republican win New York City in the 2024 presidential election?",
      category: "Politics",
      rulesPrimary: "Resolves per certified Electoral College results.",
    }));
    const expressions = result.series.map((row) => row.expression);
    expect(expressions).not.toContain("WX:NYC:high");
    expect(expressions).not.toContain("NWS:KNYC:high");
    expect(result.series.some((row) => row.expression.startsWith("WX:"))).toBe(false);
  });
});
