import { describe, expect, test } from "bun:test";
import {
  analyzeSeriesSearchQuery,
  buildCapabilitySeriesSuggestions,
  buildSeriesCatalogSuggestions,
  looksLikeCatalogSeriesQuery,
} from "./series-catalog";

const AAPL = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };

describe("chart composer series catalog", () => {
  test("maps provider catalog metadata without provider-specific core branches", () => {
    expect(buildCapabilitySeriesSuggestions([{
      capabilityId: "custom.series",
      capabilityName: "Custom Provider",
      seriesId: "series-1",
      label: "Custom history",
      style: "step",
    }])[0]).toMatchObject({
      label: "Custom history",
      detail: "Custom Provider",
      expression: {
        kind: "capability",
        capabilityId: "custom.series",
        seriesId: "series-1",
        style: "step",
      },
    });
  });

  test("maps a metric-only query onto the current security", () => {
    const suggestions = buildSeriesCatalogSuggestions("revenue", AAPL);

    expect(suggestions[0]).toMatchObject({
      label: "AAPL:XNAS — Revenue",
      expression: {
        kind: "security",
        symbol: "AAPL",
        exchange: "NASDAQ",
        fieldId: "fundamental.totalRevenue",
      },
    });
  });

  test("understands a ticker and human metric name without source syntax", () => {
    const suggestions = buildSeriesCatalogSuggestions("MSFT free cash flow", AAPL);

    expect(suggestions[0]).toMatchObject({
      label: "MSFT — Free Cash Flow",
      expression: {
        kind: "security",
        symbol: "MSFT",
        fieldId: "fundamental.freeCashFlow",
      },
    });
  });

  test("suggests a discount spread for a searched instrument", () => {
    const suggestions = buildSeriesCatalogSuggestions(
      "strc discount",
      AAPL,
      [{ symbol: "STRC" }],
    );

    expect(suggestions[0]).toMatchObject({
      label: "STRC — Discount to par",
      expressionText: "100 - STRC:price",
    });
  });

  test("separates company text from the requested metric for provider autocomplete", () => {
    expect(analyzeSeriesSearchQuery("Apple gross margin")).toEqual({
      directInstrument: null,
      instrumentQuery: "apple",
      metricQuery: "Gross Margin",
    });

    const suggestions = buildSeriesCatalogSuggestions(
      "Apple gross margin",
      AAPL,
      [{ symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." }],
    );
    expect(suggestions[0]?.expression).toMatchObject({
      symbol: "AAPL",
      fieldId: "fundamental.grossMargin",
    });
  });

  test("suggests futures contracts and Treasury maturities from the board catalogs", () => {
    expect(buildSeriesCatalogSuggestions("e-mini s&p", AAPL)[0]).toMatchObject({
      label: "FUT:ES — E-Mini S&P 500",
      expression: {
        kind: "security",
        symbol: "ES=F",
        fieldId: "market.ohlcv",
      },
    });
    expect(buildSeriesCatalogSuggestions("UST:10Y", AAPL)[0]).toMatchObject({
      label: "10Y Treasury Yield",
      expression: {
        kind: "economic",
        provider: "fred",
        seriesId: "DGS10",
      },
    });
  });

  test("keeps direct FRED IDs available for advanced sources", () => {
    expect(buildSeriesCatalogSuggestions("FRED:CPIAUCSL", AAPL)[0]).toMatchObject({
      label: "FRED — CPIAUCSL",
      expression: {
        kind: "economic",
        provider: "fred",
        seriesId: "CPIAUCSL",
      },
    });
  });
});

describe("chart composer series idea suggestions", () => {
  const MSFT = { symbol: "MSFT", name: "Microsoft Corp." };

  test("relative performance from a bare ticker pair", () => {
    expect(buildSeriesCatalogSuggestions("AAPL vs MSFT", AAPL)[0]).toMatchObject({
      label: "AAPL / MSFT — Relative Performance",
      expressionText: "AAPL:price / MSFT:price",
    });
    expect(buildSeriesCatalogSuggestions("MSFT vs. AAPL", AAPL)[0]).toMatchObject({
      expressionText: "MSFT:price / AAPL:price",
    });
    expect(buildSeriesCatalogSuggestions("relative performance", AAPL, [MSFT])[0]).toMatchObject({
      expressionText: "MSFT:price / SPY:price",
    });
  });

  test("drawdown, realized volatility, and MA distance map onto study expressions", () => {
    expect(buildSeriesCatalogSuggestions("AAPL drawdown", AAPL)[0]).toMatchObject({
      label: "AAPL — Drawdown",
      expressionText: "DD:AAPL:price",
    });
    expect(buildSeriesCatalogSuggestions("realized vol", AAPL, [MSFT])[0]).toMatchObject({
      label: "MSFT — Realized Volatility (20D annualized)",
      expressionText: "VOL:MSFT:price",
    });
    expect(buildSeriesCatalogSuggestions("distance from moving average", AAPL, [MSFT])[0]).toMatchObject({
      label: "MSFT — Distance from SMA(20)",
      expressionText: "DIST:MSFT:price",
    });
  });

  test("normalizes lowercase ticker ideas instead of falling back to the default instrument", () => {
    const defaultInstrument = { symbol: "SPY", name: "SPDR S&P 500 ETF" };

    expect(buildSeriesCatalogSuggestions("aapl drawdown", defaultInstrument)[0]).toMatchObject({
      label: "AAPL — Drawdown",
      expressionText: "DD:AAPL:price",
    });
    expect(buildSeriesCatalogSuggestions("aapl revenue growth", defaultInstrument)[0]).toMatchObject({
      label: "AAPL — Revenue Growth (YoY)",
      expression: {
        symbol: "AAPL",
        fieldId: "fundamental.totalRevenue",
        transform: "yoy",
      },
    });
    expect(buildSeriesCatalogSuggestions("aapl vol", defaultInstrument)[0]).toMatchObject({
      label: "AAPL — Realized Volatility (20D annualized)",
      expressionText: "VOL:AAPL:price",
    });
    expect(buildSeriesCatalogSuggestions("apple drawdown", defaultInstrument)).toEqual([]);
  });

  test("uses both lowercase tickers for correlation ideas", () => {
    const suggestions = buildSeriesCatalogSuggestions(
      "aapl msft correlation",
      { symbol: "SPY", name: "SPDR S&P 500 ETF" },
    );

    expect(suggestions[0]).toMatchObject({
      label: "AAPL ↔ MSFT — Correlation",
      expressionText: "CORR(AAPL:price, MSFT:price)",
    });
  });

  test("yield curve spreads pair treasury maturities", () => {
    expect(buildSeriesCatalogSuggestions("yield curve spread", AAPL)[0]).toMatchObject({
      label: "10Y − 2Y Treasury Spread",
      expressionText: "UST:10Y - UST:2Y",
    });
    expect(buildSeriesCatalogSuggestions("10s2s", AAPL)[0]?.expressionText).toBe("UST:10Y - UST:2Y");
  });

  test("growth and margin ideas reuse single-series transforms and fundamental fields", () => {
    expect(buildSeriesCatalogSuggestions("MSFT revenue growth", AAPL, [MSFT])[0]).toMatchObject({
      label: "MSFT — Revenue Growth (YoY)",
      expression: {
        kind: "security",
        symbol: "MSFT",
        fieldId: "fundamental.totalRevenue",
        transform: "yoy",
      },
    });
    expect(buildSeriesCatalogSuggestions("Apple gross margin", AAPL, [AAPL])[0]?.expression).toMatchObject({
      symbol: "AAPL",
      fieldId: "fundamental.grossMargin",
    });
  });

  test("dividend yield and correlation ideas carry runnable expression text", () => {
    expect(buildSeriesCatalogSuggestions("dividend yield", AAPL)[0]).toMatchObject({
      expression: {
        kind: "security",
        symbol: "AAPL",
        fieldId: "valuation.dividendYield",
      },
    });
    const correlation = buildSeriesCatalogSuggestions("correlation", AAPL, [MSFT])[0];
    expect(correlation?.label).toBe("MSFT ↔ SPY — Correlation");
    expect(correlation?.expressionText).toBe("CORR(MSFT:price, SPY:price)");
  });

  test("prediction-market spreads pair two live market hits", () => {
    const hits = [
      { venue: "polymarket" as const, marketId: "will-fed-cut-rates-2026", title: "Will the Fed cut rates?" },
      { venue: "kalshi" as const, marketId: "KXFEDCUT", title: "Fed to cut rates?" },
    ];
    const suggestions = buildSeriesCatalogSuggestions("fed cut spread", AAPL, [], 8, hits);
    expect(suggestions[0]?.expressionText).toBe("POLY:will-fed-cut-rates-2026 - KALSHI:KXFEDCUT");
    expect(suggestions[0]?.label).toBe("Will the Fed cut rates? − Fed to cut rates? — Spread");
  });

  test("catalog-query detection recognizes idea language without false positives", () => {
    for (const query of [
      "AAPL vs MSFT",
      "MSFT vs. AAPL",
      "drawdown",
      "realized vol",
      "AAPL vol",
      "yield curve",
      "revenue growth",
      "gross margin",
      "dividend yield",
      "correlation",
      "ma distance",
      "relative performance",
    ]) {
      expect(looksLikeCatalogSeriesQuery(query), query).toBe(true);
    }
    for (const query of [
      "AAPL revenue",
      "AAPL vs MSFT revenue",
      "open settings",
      "untitled note",
    ]) {
      expect(looksLikeCatalogSeriesQuery(query), query).toBe(false);
    }
  });
});
