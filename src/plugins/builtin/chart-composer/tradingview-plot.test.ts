import { describe, expect, test } from "bun:test";
import { buildBoundChartPreset, buildComparisonChartPreset, buildCustomChartPreset, buildFundamentalChartPreset, buildIntradayPriceChartPreset, buildPriceChartPreset } from "./presets";
import {
  resolveTradingViewPlot,
  tradingViewEmbedSrc,
  tradingViewIntervalForSpec,
  tradingViewPublicChartUrl,
  tradingViewSymbolForSecurity,
} from "./tradingview-plot";

describe("tradingViewSymbolForSecurity", () => {
  test("prefixes a NASDAQ listing", () => {
    expect(tradingViewSymbolForSecurity({ symbol: "AAPL", exchange: "NASDAQ" })).toBe("NASDAQ:AAPL");
  });

  test("remaps JPX onto TSE", () => {
    expect(tradingViewSymbolForSecurity({ symbol: "7203", exchange: "JPX" })).toBe("TSE:7203");
  });

  test("leaves a listing without an exchange for TradingView to resolve", () => {
    expect(tradingViewSymbolForSecurity({ symbol: "AAPL" })).toBe("AAPL");
  });

  test("charts a crypto pair as a Binance spot price, not market cap", () => {
    expect(tradingViewSymbolForSecurity({ symbol: "BTC-USD", exchange: "CCC" })).toBe("BINANCE:BTCUSDT");
    expect(tradingViewSymbolForSecurity({ symbol: "ZEC/USD" })).toBe("BINANCE:ZECUSDT");
    expect(tradingViewSymbolForSecurity({ symbol: "ZECUSD", exchange: "CCC" })).toBe("BINANCE:ZECUSDT");
    expect(tradingViewSymbolForSecurity({ symbol: "ETH-EUR", exchange: "CCC" })).toBe("BINANCE:ETHEUR");
  });
});

describe("resolveTradingViewPlot", () => {
  test("maps a price chart to a widget", () => {
    const plot = resolveTradingViewPlot(buildPriceChartPreset("AAPL:NASDAQ"));
    expect(plot).toEqual({
      kind: "widget",
      symbol: "NASDAQ:AAPL",
      compareSymbols: [],
      interval: "W",
      timezone: "America/New_York",
    });
  });

  test("maps GIP to a one-minute interval", () => {
    const plot = resolveTradingViewPlot(buildIntradayPriceChartPreset("MSFT:NASDAQ"));
    expect(plot.kind).toBe("widget");
    if (plot.kind !== "widget") return;
    expect(plot.interval).toBe("1");
    expect(plot.symbol).toBe("NASDAQ:MSFT");
  });

  test("maps comparison tickers onto compareSymbols", () => {
    const plot = resolveTradingViewPlot(buildComparisonChartPreset(["AAPL:NASDAQ", "MSFT:NASDAQ"]));
    expect(plot).toMatchObject({
      kind: "widget",
      symbol: "NASDAQ:AAPL",
      compareSymbols: ["NASDAQ:MSFT"],
      interval: "D",
    });
  });

  test("maps a FRED series", () => {
    const plot = resolveTradingViewPlot(buildCustomChartPreset("FRED:CPIAUCSL"));
    expect(plot).toMatchObject({
      kind: "widget",
      symbol: "FRED:CPIAUCSL",
    });
  });

  test("does not map a fundamental series onto TradingView", () => {
    expect(resolveTradingViewPlot(buildFundamentalChartPreset(["AAPL"]))).toEqual({ kind: "unmapped" });
  });

  test("does not map an empty spec", () => {
    expect(resolveTradingViewPlot(buildCustomChartPreset(""))).toEqual({ kind: "unmapped" });
  });

  test("keeps G ARINTI off the TradingView widget", () => {
    const spec = buildCustomChartPreset("ARINTI");
    expect(spec.series[0]?.source).toEqual({ kind: "adjacent-index", indexId: "ari_nti" });
    expect(resolveTradingViewPlot(spec)).toEqual({ kind: "unmapped" });
  });

  test("keeps a derived STRC discount-to-par spread off the TradingView widget", () => {
    const spec = buildCustomChartPreset("100 - STRC:price");
    expect(spec.series.every((series) => series.visible === false)).toBe(true);
    expect(resolveTradingViewPlot(spec)).toEqual({ kind: "unmapped" });
  });

  test("keeps a followed ARINTI ticker off the TradingView widget", () => {
    expect(resolveTradingViewPlot(buildCustomChartPreset("", "ARINTI"))).toEqual({ kind: "unmapped" });
    expect(resolveTradingViewPlot(buildPriceChartPreset("ARINTI"))).toEqual({ kind: "unmapped" });
  });

  test("keeps a bound POLY DES chart on Lightweight Charts", () => {
    const spec = buildBoundChartPreset("POLY:how-many-fed-rate-cuts-in-2026");
    expect(spec.series[0]?.source).toMatchObject({
      kind: "prediction-market",
      venue: "polymarket",
      marketId: "how-many-fed-rate-cuts-in-2026",
    });
    expect(resolveTradingViewPlot(spec)).toEqual({ kind: "unmapped" });
  });
});

describe("tradingViewIntervalForSpec", () => {
  test("uses the range preset when AUTO is on", () => {
    expect(tradingViewIntervalForSpec({ viewport: { range: "1D", resolution: "auto" } })).toBe("1");
    expect(tradingViewIntervalForSpec({ viewport: { range: "1Y", resolution: "auto" } })).toBe("D");
  });
});

describe("tradingViewEmbedSrc", () => {
  test("embeds symbol, interval, and drawings chrome", () => {
    const src = tradingViewEmbedSrc({
      kind: "widget",
      symbol: "NASDAQ:AAPL",
      compareSymbols: [],
      interval: "D",
      timezone: "America/New_York",
    }, { theme: "dark", backgroundColor: "#16140f" });
    expect(src.startsWith("https://www.tradingview.com/embed-widget/advanced-chart/?locale=en#")).toBe(true);
    const config = JSON.parse(decodeURIComponent(src.slice(src.indexOf("#") + 1))) as Record<string, unknown>;
    expect(config.symbol).toBe("NASDAQ:AAPL");
    expect(config.interval).toBe("D");
    expect(config.hide_side_toolbar).toBe(false);
    expect(config.hide_volume).toBe(true);
    expect(config.hide_top_toolbar).toBe(false);
  });
});

describe("tradingViewPublicChartUrl", () => {
  test("opens the same symbol on TradingView", () => {
    expect(tradingViewPublicChartUrl("NASDAQ:AAPL")).toBe("https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL");
  });
});
