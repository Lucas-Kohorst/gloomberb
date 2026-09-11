import { describe, expect, test } from "bun:test";
import {
  canToggleChartSeries,
  parseChartSpec,
  projectVisibleChartSeries,
  serializeChartSpec,
  toggleChartSeries,
} from "./chart-spec";
import {
  appendChartSeries,
  applyChartIdeaToSpec,
  buildComparisonChartPreset,
  buildCustomChartPreset,
  buildFundamentalChartPreset,
  buildIntradayPriceChartPreset,
  buildBoundChartPreset,
  buildPriceChartPreset,
  buildSeriesSpec,
  appendCompareTicker,
  applySeriesStyle,
  applySeriesTimestampMode,
  formatCorrelationExpression,
  formatChartStudyExpression,
  getSelectedBuiltinStudies,
  getSelectedPairStudies,
  isChartIdeaExpression,
  formatSeriesExpression,
  parseBinarySeriesExpression,
  parseChartExpression,
  parseCorrelationExpression,
  parseSeriesExpression,
  parseStudyExpression,
  rebindChartSecuritySymbol,
  resolveChartFieldAlias,
  setBuiltinStudies,
  setChartDisplayTimeZone,
  setMainPanelScale,
  setPairStudies,
  toggleMainPanelAutoScale,
  toggleMainPanelPercentScale,
} from "./presets";
import { applyChartComposerCapabilityOptions } from "./cli-options";
import { defaultChartSeriesPresentation, validateChartSpec } from "../../../time-series/spec";

describe("chart composer expressions", () => {
  test("round-trips bounded provider-neutral capability expressions", () => {
    const expression = {
      kind: "capability" as const,
      capabilityId: "prediction-markets.series",
      seriesId: "polymarket/event-1/market-1",
      label: "Will it happen?",
    };
    const series = buildSeriesSpec(expression, 0);
    expect(parseSeriesExpression(formatSeriesExpression(series))).toEqual({
      kind: "capability",
      capabilityId: expression.capabilityId,
      seriesId: expression.seriesId,
    });
    expect(parseSeriesExpression("CAP:provider:series?params=%7B%7D")).toBeNull();
    expect(parseSeriesExpression(`CAP:${"x".repeat(81)}:series`)).toBeNull();
    expect(parseSeriesExpression(`CAP:provider:${"x".repeat(241)}`)).toBeNull();
  });

  test("maps futures and Treasury aliases onto existing core source kinds", () => {
    expect(parseSeriesExpression("fut:es")).toEqual({
      kind: "security",
      symbol: "ES=F",
      fieldId: "market.ohlcv",
      label: "E-Mini S&P 500",
    });
    expect(parseSeriesExpression("ust:10y")).toEqual({
      kind: "economic",
      provider: "fred",
      seriesId: "DGS10",
      label: "10Y Treasury Yield",
    });
    expect(parseSeriesExpression("FUT:UNKNOWN")).toBeNull();
    expect(parseSeriesExpression("UST:4Y")).toBeNull();
  });

  test("appends catalog series with required panels and collision-safe IDs", () => {
    const initial = buildCustomChartPreset("AAPL:price, MSFT:price");
    const withVolume = appendChartSeries(initial, {
      kind: "security",
      symbol: "AAPL",
      fieldId: "market.volume",
    });
    expect(withVolume.spec.panels.some((panel) => panel.id === "volume")).toBe(true);

    const repeated = buildCustomChartPreset("AAPL:price, AAPL:price, AAPL:price");
    const withRemovedMiddle = {
      ...repeated,
      series: [repeated.series[0]!, repeated.series[2]!],
    };
    const appended = appendChartSeries(withRemovedMiddle, {
      kind: "security",
      symbol: "AAPL",
      fieldId: "market.ohlcv",
    });

    expect(appended.spec.series.map((series) => series.id)).toEqual([
      "aapl-market-ohlcv-1",
      "aapl-market-ohlcv-3",
      "aapl-market-ohlcv-3-2",
    ]);
  });

  test("bound research charts keep POLY/KALSHI as prediction series", () => {
    const poly = buildBoundChartPreset("POLY:clarity-act-signed-into-law-in-2026");
    expect(poly.series[0]?.source).toMatchObject({
      kind: "prediction-market",
      venue: "polymarket",
      marketId: "clarity-act-signed-into-law-in-2026",
    });
    const equity = buildBoundChartPreset("AAPL");
    expect(equity.series[0]?.source).toMatchObject({ kind: "security", instrument: { symbol: "AAPL" } });
  });

  test("places appended financial data in a synchronized panel without rewriting authored state", () => {
    const price = buildPriceChartPreset("AAPL");
    const authored = {
      ...price,
      viewport: { ...price.viewport, range: "3M" as const },
      panels: [...price.panels, { id: "notes", label: "Reserved", height: 0.4 }],
    };
    const appended = appendChartSeries(authored, {
      kind: "security",
      symbol: "MSFT",
      fieldId: "fundamental.totalRevenue",
    });

    expect(appended.spec.viewport).toEqual(authored.viewport);
    expect(appended.spec.studies).toEqual(authored.studies);
    expect(appended.spec.series[0]).toEqual(authored.series[0]);
    expect(appended.spec.panels.slice(0, authored.panels.length)).toEqual(authored.panels);
    expect(appended.series).toMatchObject({
      style: "columns",
      panelId: "fundamentals",
      source: { timestampMode: "available-at" },
    });
    expect(appended.spec.panels.find((panel) => panel.id === "fundamentals")).toMatchObject({
      label: "Fundamentals",
      height: 0.35,
    });
  });

  test("places only the new candidate when incremental axes or panel scopes overflow", () => {
    const fundamentals = buildFundamentalChartPreset(["AAPL"]);
    const withPrice = appendChartSeries(fundamentals, {
      kind: "security",
      symbol: "AAPL",
      fieldId: "market.ohlcv",
    });
    expect(withPrice.spec.series[0]).toEqual(fundamentals.series[0]);
    expect(withPrice.series.panelId).toBe("panel-2");

    const price = buildPriceChartPreset("AAPL");
    const withCpi = appendChartSeries(price, {
      kind: "economic",
      provider: "fred",
      seriesId: "CPIAUCSL",
    }).spec;
    const withRates = appendChartSeries(withCpi, {
      kind: "economic",
      provider: "fred",
      seriesId: "UNRATE",
    });
    expect(withRates.spec.series.slice(0, 2).map((series) => series.panelId))
      .toEqual(["main", "main"]);
    expect(withRates.series.panelId).toBe("panel-2");
    expect(withRates.spec.panels.find((panel) => panel.id === "panel-2")).toMatchObject({
      label: "Panel 2",
      height: 0.35,
    });
  });

  test("renders an appended secondary OHLCV price as a valid comparison line", () => {
    const initial = buildPriceChartPreset("AAPL");
    const appended = appendChartSeries(initial, {
      kind: "security",
      symbol: "META",
      fieldId: "market.ohlcv",
    });

    expect(initial.series[0]).toMatchObject({ style: "candles", panelId: "main" });
    expect(appended.series).toMatchObject({
      source: {
        kind: "security",
        instrument: { symbol: "META" },
        fieldId: "market.ohlcv",
      },
      style: "line",
      transform: "raw",
      interpolation: "none",
      panelId: "main",
    });
    expect(parseChartSpec(appended.spec)).not.toBeNull();
  });

  test("keeps bulk custom price expressions valid with one OHLC presentation per panel", () => {
    const spec = buildCustomChartPreset("AAPL:price, META:price");

    expect(spec.series.map(({ style, transform, interpolation }) => ({
      style,
      transform,
      interpolation,
    }))).toEqual([
      { style: "candles", transform: "raw", interpolation: "none" },
      { style: "line", transform: "raw", interpolation: "none" },
    ]);
    expect(parseChartSpec(spec)).not.toBeNull();
  });

  test("charts a crypto catalog row as SYMBOL:price", () => {
    expect(parseSeriesExpression("ETH-USD:price")).toEqual({
      kind: "security",
      symbol: "ETH-USD",
      fieldId: "market.ohlcv",
    });
    const spec = buildCustomChartPreset("ETH-USD:price");
    expect(spec.series[0]).toMatchObject({
      source: {
        kind: "security",
        instrument: { symbol: "ETH-USD" },
        fieldId: "market.ohlcv",
      },
    });
    expect(parseChartSpec(spec)).not.toBeNull();
  });

  test("accepts catalog aliases and FRED series in one expression", () => {
    expect(parseChartExpression(
      "aapl:price; msft:Free Cash Flow Margin\nFRED:CPIAUCSL",
    )).toEqual([
      { kind: "security", symbol: "AAPL", fieldId: "market.ohlcv" },
      { kind: "security", symbol: "MSFT", fieldId: "fundamental.freeCashFlowMargin" },
      { kind: "economic", provider: "fred", seriesId: "CPIAUCSL" },
    ]);
    expect(resolveChartFieldAlias("EV / EBITDA")).toBe("valuation.evEbitda");
  });

  test("rejects an invalid leg instead of silently building a partial chart", () => {
    expect(() => buildCustomChartPreset("AAPL:price, MSFT:revenu"))
      .toThrow('Invalid chart series "MSFT:revenu"');
  });

  test("builds a ratio study from a binary `a / b` expression", () => {
    const spec = buildCustomChartPreset("AAPL:price / AAPL:revenue");
    expect(spec.series.map((series) => series.source)).toEqual([
      expect.objectContaining({ kind: "security", instrument: expect.objectContaining({ symbol: "AAPL" }), fieldId: "market.ohlcv" }),
      expect.objectContaining({ kind: "security", instrument: expect.objectContaining({ symbol: "AAPL" }), fieldId: "fundamental.totalRevenue" }),
    ]);
    const ratio = spec.studies.find((study) => study.kind === "ratio");
    expect(ratio).toBeDefined();
    expect(ratio!.inputSeriesIds).toEqual(spec.series.slice(0, 2).map((series) => series.id));
  });

  test("plots only the derived line for a binary expression", () => {
    const spec = buildCustomChartPreset("AAPL:price / NVDA:price");
    expect(spec.series.every((series) => series.visible === false)).toBe(true);
    expect(spec.studies.find((study) => study.kind === "ratio")).toBeDefined();
  });

  test("keeps a pair study bound to hidden operands when the spec is rebuilt", () => {
    const spec = buildCustomChartPreset("AAPL:price / NVDA:price");
    const rebound = setPairStudies(spec, getSelectedPairStudies(spec));
    expect(rebound.studies.find((study) => study.kind === "ratio")?.inputSeriesIds)
      .toEqual(spec.series.map((series) => series.id));
  });

  test("builds a spread study from a binary `a - b` expression", () => {
    const spec = buildCustomChartPreset("AAPL:price - MSFT:price");
    const spread = spec.studies.find((study) => study.kind === "spread");
    expect(spread).toBeDefined();
    expect(spec.series).toHaveLength(2);
  });

  test("builds a spread study from a numeric constant on the left", () => {
    const spec = buildCustomChartPreset("100 - STRC:price");
    expect(spec.series.map((series) => series.source)).toEqual([
      { kind: "constant", value: 100 },
      expect.objectContaining({ kind: "security", instrument: { symbol: "STRC" }, fieldId: "market.ohlcv" }),
    ]);
    const spread = spec.studies.find((study) => study.kind === "spread");
    expect(spread).toBeDefined();
    expect(spread!.inputSeriesIds).toEqual(spec.series.slice(0, 2).map((series) => series.id));
    expect(parseChartSpec(spec)).not.toBeNull();
  });

  test("builds a ratio study with the constant on the right", () => {
    const spec = buildCustomChartPreset("AAPL:price / 2");
    expect(spec.series[0]?.source).toMatchObject({ kind: "security", instrument: { symbol: "AAPL" } });
    expect(spec.series[1]?.source).toEqual({ kind: "constant", value: 2 });
    expect(spec.studies.find((study) => study.kind === "ratio")).toBeDefined();
  });

  test("does not treat a lone numeric literal as a binary expression", () => {
    expect(parseBinarySeriesExpression("100")).toBeNull();
    expect(buildCustomChartPreset("100").series.map((series) => series.source))
      .toEqual([expect.objectContaining({ kind: "security", instrument: { symbol: "100" } })]);
  });

  test("does not treat a single series as a binary expression", () => {
    const spec = buildCustomChartPreset("AAPL:revenue");
    expect(spec.studies.filter((study) => study.kind === "ratio" || study.kind === "spread")).toHaveLength(0);
  });

  test("plots a Polymarket Fed-cut series with the actual Fed funds rate", () => {
    const spec = buildCustomChartPreset("POLY:fed-cut-september, FRED:FEDFUNDS");
    expect(spec.series).toHaveLength(2);
    expect(spec.series[0]?.source).toMatchObject({
      kind: "prediction-market",
      venue: "polymarket",
      marketId: "fed-cut-september",
    });
    expect(spec.series[1]?.source).toMatchObject({
      kind: "economic",
      provider: "fred",
      seriesId: "FEDFUNDS",
    });
  });

  test("defaults assets to price, macro to level, polls to percent, and PM to probability", () => {
    const price = buildCustomChartPreset("AAPL");
    const macro = buildCustomChartPreset("FRED:CPIAUCSL");
    const poll = buildCustomChartPreset("POLL:Donald Trump:Approve");
    const pm = buildCustomChartPreset("KALSHI:KXPRESPERSON");

    expect(price.series[0]).toMatchObject({ style: "candles", transform: "raw" });
    expect(defaultChartSeriesPresentation(price.series[0]!.source).unitGroup).toBe("price");
    expect(macro.series[0]).toMatchObject({ style: "step", transform: "raw" });
    expect(defaultChartSeriesPresentation(macro.series[0]!.source).unitGroup).toBe("level");
    expect(defaultChartSeriesPresentation(poll.series[0]!.source)).toMatchObject({
      unitGroup: "percent",
      valueRange: { min: 0, max: 100 },
    });
    expect(defaultChartSeriesPresentation(pm.series[0]!.source)).toMatchObject({
      unitGroup: "probability",
      valueRange: { min: 0, max: 100 },
    });
  });

  test("plots dividend history from G AAPL:div and G AAPL:dvd", () => {
    expect(parseChartExpression("AAPL:div")).toEqual([
      { kind: "security", symbol: "AAPL", fieldId: "market.dividends" },
    ]);
    expect(parseChartExpression("AAPL:DVD")).toEqual([
      { kind: "security", symbol: "AAPL", fieldId: "market.dividends" },
    ]);
    expect(resolveChartFieldAlias("dvd")).toBe("market.dividends");
  });

  test("parses exchange-qualified tickers without confusing the exchange for a field", () => {
    const spec = buildCustomChartPreset("3hnx:lse, 3HNX:LSE:revenue");

    expect(spec.series.map((series) => series.source)).toEqual([
      expect.objectContaining({
        kind: "security",
        instrument: { symbol: "3HNX", exchange: "LSE" },
        fieldId: "market.ohlcv",
      }),
      expect.objectContaining({
        kind: "security",
        instrument: { symbol: "3HNX", exchange: "LSE" },
        fieldId: "fundamental.totalRevenue",
      }),
    ]);
  });

  test("builds mixed-frequency series with source-appropriate presentation", () => {
    const spec = buildCustomChartPreset("AAPL:price, MSFT:revenue, FRED:CPIAUCSL");

    expect(spec.series.map((series) => series.source.kind)).toEqual([
      "security",
      "security",
      "economic",
    ]);
    expect(spec.series[0]).toMatchObject({ style: "candles", interpolation: "none" });
    expect(spec.series[1]).toMatchObject({
      style: "columns",
      interpolation: "none",
      panelId: "fundamentals",
      source: {
        kind: "security",
        fieldId: "fundamental.totalRevenue",
        period: "quarterly",
        timestampMode: "available-at",
      },
    });
    expect(spec.series[2]).toMatchObject({
      style: "step",
      interpolation: "step-after",
      panelId: "panel-2",
      source: { kind: "economic", provider: "fred", seriesId: "CPIAUCSL" },
    });
    expect(spec.panels.find((panel) => panel.id === "panel-2")).toMatchObject({
      label: "Panel 2",
      height: 0.35,
    });
    expect(spec.panels.find((panel) => panel.id === "fundamentals")).toMatchObject({
      label: "Fundamentals",
      height: 0.35,
    });

    const reversed = buildCustomChartPreset("MSFT:revenue, AAPL:price");
    const price = reversed.series.find((series) => (
      series.source.kind === "security" && series.source.fieldId === "market.ohlcv"
    ));
    const revenue = reversed.series.find((series) => (
      series.source.kind === "security" && series.source.fieldId === "fundamental.totalRevenue"
    ));
    expect(price?.panelId).toBe("main");
    expect(revenue).toMatchObject({
      panelId: "fundamentals",
      style: "columns",
      source: { timestampMode: "available-at" },
    });

    expect(buildCustomChartPreset("AAPL:revenue, MSFT:revenue").series.map((series) => series.axis))
      .toEqual(["auto", "auto"]);
  });

  test("keeps interpolation consistent with an overridden series style", () => {
    expect(buildSeriesSpec(
      { kind: "security", symbol: "AAPL", fieldId: "fundamental.totalRevenue" },
      0,
      { style: "columns", interpolation: "step-after" },
    )).toMatchObject({
      style: "columns",
      interpolation: "none",
      source: { timestampMode: "period-end" },
    });
    expect(buildSeriesSpec(
      { kind: "economic", provider: "fred", seriesId: "CPIAUCSL" },
      0,
      { style: "line", interpolation: "step-after" },
    )).toMatchObject({
      style: "line",
      interpolation: "none",
    });
  });
});

describe("chart composer study and derived expressions", () => {
  test("parses DD:, VOL:, and DIST: study expressions", () => {
    expect(parseStudyExpression("DD:AAPL:price")).toEqual({
      kind: "drawdown",
      source: { kind: "security", symbol: "AAPL", fieldId: "market.ohlcv" },
    });
    expect(parseStudyExpression("VOL:SPY")).toEqual({
      kind: "volatility",
      source: { kind: "security", symbol: "SPY", fieldId: "market.ohlcv" },
    });
    expect(parseStudyExpression("VOL:10:SPY")).toEqual({
      kind: "volatility",
      period: 10,
      source: { kind: "security", symbol: "SPY", fieldId: "market.ohlcv" },
    });
    expect(parseStudyExpression("DIST:200:MSFT:price")).toEqual({
      kind: "distance",
      period: 200,
      source: { kind: "security", symbol: "MSFT", fieldId: "market.ohlcv" },
    });
    expect(parseStudyExpression("DD:FRED:CPIAUCSL")).toEqual({
      kind: "drawdown",
      source: { kind: "economic", provider: "fred", seriesId: "CPIAUCSL" },
    });
    expect(parseStudyExpression("XYZ:AAPL")).toBeNull();
    expect(parseStudyExpression("VOL:0:SPY")).toBeNull();
    expect(parseStudyExpression("VOL:99999:SPY")).toBeNull();
  });

  test("builds valid study presets with the source and a study on its own panel", () => {
    for (const [text, expectedPanel, expectedKind] of [
      ["DD:AAPL:price", "drawdown", "drawdown"],
      ["VOL:SPY", "volatility", "volatility"],
      ["DIST:200:MSFT:price", "distance", "distance"],
    ] as const) {
      const spec = buildCustomChartPreset(text);
      expect(spec.series).toHaveLength(1);
      expect(spec.studies).toHaveLength(1);
      expect(spec.studies[0]!.kind).toBe(expectedKind);
      expect(spec.studies[0]!.panelId).toBe(expectedPanel);
      expect(spec.studies[0]!.inputSeriesIds).toEqual([spec.series[0]!.id]);
      expect(validateChartSpec(spec).errors).toEqual([]);
    }
  });

  test("study presets survive a spec serialization round-trip", () => {
    for (const text of ["DD:AAPL:price", "VOL:10:SPY", "DIST:200:MSFT:price"]) {
      const spec = buildCustomChartPreset(text);
      const persisted = parseChartSpec(serializeChartSpec(spec));
      expect(persisted, text).not.toBeNull();
      expect(persisted?.studies[0]).toMatchObject({
        kind: spec.studies[0]!.kind,
        panelId: spec.studies[0]!.panelId,
        inputSeriesIds: spec.studies[0]!.inputSeriesIds,
      });
    }
  });

  test("study expression text round-trips through its formatter", () => {
    expect(formatChartStudyExpression(parseStudyExpression("DD:AAPL:price")!))
      .toBe("DD:AAPL:market.ohlcv");
    expect(formatChartStudyExpression(parseStudyExpression("VOL:10:SPY")!))
      .toBe("VOL:10:SPY:market.ohlcv");
    expect(parseStudyExpression(formatChartStudyExpression(parseStudyExpression("VOL:20:SPY")!)))
      .toEqual(parseStudyExpression("VOL:SPY"));
  });

  test("parses and formats CORR(left, right) leg pairs", () => {
    const parsed = parseCorrelationExpression("CORR(AAPL:price, MSFT:price)");
    expect(parsed).toEqual({
      left: { kind: "security", symbol: "AAPL", fieldId: "market.ohlcv" },
      right: { kind: "security", symbol: "MSFT", fieldId: "market.ohlcv" },
    });
    expect(parseCorrelationExpression(formatCorrelationExpression(parsed!))).toEqual(parsed);
    expect(parseCorrelationExpression("CORR(AAPL:price, MSFT:price")).toBeNull();
  });

  test("correlation presets keep both operands hidden behind the derived study", () => {
    const spec = buildCustomChartPreset("CORR(AAPL:price, MSFT:price)");
    expect(spec.series).toHaveLength(2);
    expect(spec.series.every((series) => series.visible === false)).toBe(true);
    expect(spec.studies).toHaveLength(1);
    expect(spec.studies[0]!.kind).toBe("correlation");
    expect(spec.studies[0]!.inputSeriesIds).toEqual(spec.series.map((series) => series.id));
    expect(validateChartSpec(spec).errors).toEqual([]);
  });

  test("isChartIdeaExpression flags only study and correlation text", () => {
    expect(isChartIdeaExpression("DD:AAPL:price")).toBe(true);
    expect(isChartIdeaExpression("VOL:20:SPY")).toBe(true);
    expect(isChartIdeaExpression("CORR(AAPL:price, MSFT:price)")).toBe(true);
    expect(isChartIdeaExpression("AAPL:price")).toBe(false);
    expect(isChartIdeaExpression("AAPL:price - MSFT:price")).toBe(false);
    expect(isChartIdeaExpression("AAPL:price / MSFT:price")).toBe(false);
  });

  test("a third transform leg parses and coerces OHLC presentation to a line", () => {
    expect(parseSeriesExpression("AAPL:revenue:yoy")).toEqual({
      kind: "security",
      symbol: "AAPL",
      fieldId: "fundamental.totalRevenue",
      transform: "yoy",
    });
    // the transform guard must not eat exchange-qualified symbols
    expect(parseSeriesExpression("AAPL:XNAS:price")).toEqual({
      kind: "security",
      symbol: "AAPL",
      exchange: "NASDAQ",
      fieldId: "market.ohlcv",
    });
    const spec = buildCustomChartPreset("AAPL:price:percent");
    expect(spec.series[0]!.transform).toBe("percent");
    expect(spec.series[0]!.style).toBe("line");
    expect(validateChartSpec(spec).errors).toEqual([]);
    expect(parseSeriesExpression(formatSeriesExpression(spec.series[0]!))).toEqual({
      kind: "security",
      symbol: "AAPL",
      fieldId: "market.ohlcv",
      transform: "percent",
    });
    expect(parseSeriesExpression("AAPL:XNAS:revenue:yoy")).toEqual({
      kind: "security",
      symbol: "AAPL",
      exchange: "NASDAQ",
      fieldId: "fundamental.totalRevenue",
      transform: "yoy",
    });
  });
});

describe("chart composer idea application onto an open spec", () => {
  test("reuses a charted source instead of appending a second candle", () => {
    const live = buildCustomChartPreset("AAPL:price, MSFT:price");
    const dd = applyChartIdeaToSpec(live, "DD:AAPL:price");
    expect(dd?.appended).toEqual([]);
    expect(dd?.spec.series.map((series) => series.id)).toEqual([
      "aapl-market-ohlcv-1",
      "msft-market-ohlcv-2",
    ]);
    expect(dd?.spec.studies[0]).toMatchObject({
      kind: "drawdown",
      inputSeriesIds: ["aapl-market-ohlcv-1"],
    });
    expect(validateChartSpec(dd!.spec).errors).toEqual([]);
  });

  test("appends only the sources the chart does not already have", () => {
    const live = buildCustomChartPreset("AAPL:price, MSFT:price");
    const spread = applyChartIdeaToSpec(live, "AAPL:price - SPY:price");
    expect(spread?.appended.map((series) => series.id)).toEqual(["spy-market-ohlcv-2"]);
    expect(spread?.spec.series).toHaveLength(3);
    expect(spread?.spec.studies[0]).toMatchObject({
      kind: "spread",
      inputSeriesIds: ["aapl-market-ohlcv-1", "spy-market-ohlcv-2"],
    });
    const ratio = applyChartIdeaToSpec(live, "AAPL:price / MSFT:price");
    expect(ratio?.appended).toEqual([]);
    expect(ratio?.spec.studies[0]!.kind).toBe("ratio");
    const correlation = applyChartIdeaToSpec(live, "CORR(AAPL:price, MSFT:price)");
    expect(correlation?.appended).toEqual([]);
    expect(correlation?.spec.studies[0]!.kind).toBe("correlation");
    expect(validateChartSpec(spread!.spec).errors).toEqual([]);
    expect(validateChartSpec(ratio!.spec).errors).toEqual([]);
    expect(validateChartSpec(correlation!.spec).errors).toEqual([]);
  });

  test("merges fresh study/formula panels and supersedes prior pair studies", () => {
    const live = buildCustomChartPreset("AAPL:price / MSFT:price");
    expect(live.panels.map((panel) => panel.id)).toEqual(["main", "formula"]);
    const spread = applyChartIdeaToSpec(live, "AAPL:price - MSFT:price");
    expect(spread?.spec.studies.map((study) => study.kind)).toEqual(["spread"]);
    expect(spread?.spec.panels.map((panel) => panel.id)).toEqual(["main", "formula"]);
    const drawdown = applyChartIdeaToSpec(spread!.spec, "DD:MSFT:price");
    expect(drawdown?.spec.studies.map((study) => study.kind)).toEqual(["spread", "drawdown"]);
    expect(drawdown?.spec.panels.map((panel) => panel.id)).toEqual(["main", "formula", "drawdown"]);
    expect(validateChartSpec(drawdown!.spec).errors).toEqual([]);
  });

  test("keeps collision-safe ids when merging over repeated sources", () => {
    const live = buildCustomChartPreset("AAPL:price");
    const merged = applyChartIdeaToSpec(
      applyChartIdeaToSpec(live, "DD:AAPL:price")!.spec,
      "VOL:10:AAPL:price",
    );
    expect(merged?.spec.series).toHaveLength(1);
    expect(merged?.spec.studies.map((study) => study.kind)).toEqual(["drawdown", "volatility"]);
    expect(validateChartSpec(merged!.spec).errors).toEqual([]);
  });

  test("returns null for ordinary single-series text", () => {
    expect(applyChartIdeaToSpec(buildCustomChartPreset("AAPL:price"), "MSFT:price")).toBeNull();
    expect(applyChartIdeaToSpec(buildCustomChartPreset("AAPL:price"), "not an idea at all")).toBeNull();
  });
});

describe("chart composer presets and formulas", () => {
  test("keeps shortcut presets semantically distinct", () => {
    const intraday = buildIntradayPriceChartPreset("aapl");
    expect(intraday.viewport).toEqual({ range: "1D", resolution: "1m" });
    expect(intraday.series[0]).toMatchObject({ style: "candles", transform: "raw" });
    expect(getSelectedBuiltinStudies(intraday)).toEqual(["volume"]);

    const comparison = buildComparisonChartPreset(["aapl", "msft"]);
    expect(comparison.series.map((series) => ({ style: series.style, transform: series.transform }))).toEqual([
      { style: "line", transform: "percent" },
      { style: "line", transform: "percent" },
    ]);

    const percent = toggleMainPanelPercentScale(buildPriceChartPreset("AAPL"));
    expect(percent.panels.find((panel) => panel.id === "main")?.scale).toBe("percent");
    expect(toggleMainPanelPercentScale(percent).panels.find((panel) => panel.id === "main")?.scale)
      .toBe("linear");
    expect(setMainPanelScale(percent, "log").panels.find((panel) => panel.id === "main")?.scale)
      .toBe("log");

    const autoOff = toggleMainPanelAutoScale(buildPriceChartPreset("AAPL"));
    expect(autoOff.panels.find((panel) => panel.id === "main")?.autoScale).toBe(false);
    expect(toggleMainPanelAutoScale(autoOff).panels.find((panel) => panel.id === "main")?.autoScale)
      .toBeUndefined();

    const compared = appendCompareTicker(buildPriceChartPreset("AAPL"), "MSFT");
    expect(compared?.panels.find((panel) => panel.id === "main")?.scale).toBe("percent");
    expect(compared?.series[0]).toMatchObject({ style: "line" });
    expect(compared?.series.some((series) => (
      series.source.kind === "security" && series.source.instrument.symbol === "MSFT"
    ))).toBe(true);
    expect(appendCompareTicker(compared!, "MSFT")).toBeNull();
    expect(setChartDisplayTimeZone(buildPriceChartPreset("AAPL"), "Asia/Tokyo").viewport.timeZone)
      .toBe("Asia/Tokyo");

    const fundamental = buildFundamentalChartPreset(["aapl"]);
    expect(fundamental.series[0]).toMatchObject({
      style: "columns",
      interpolation: "none",
      source: { fieldId: "fundamental.totalRevenue", timestampMode: "period-end" },
    });
  });

  test("keeps one visible base series and projects visibility without waiting for data reload", () => {
    const spec = buildComparisonChartPreset(["AAPL", "MSFT"]);
    const resolved = spec.series.map((series, index) => ({
      id: series.id,
      label: series.id,
      color: index === 0 ? "#fff" : "#aaa",
      unit: "USD",
      unitGroup: "price",
      nativeFrequency: "daily" as const,
      dataShape: "scalar" as const,
      style: series.style,
      transform: series.transform,
      axis: "left" as const,
      panelId: series.panelId,
      interpolation: series.interpolation,
      points: [],
    }));

    const withHiddenSecond = toggleChartSeries(spec, spec.series[1]!.id);
    expect(withHiddenSecond.series[1]?.visible).toBe(false);
    expect(projectVisibleChartSeries(withHiddenSecond, resolved).map((series) => series.id))
      .toEqual([spec.series[0]!.id]);
    expect(canToggleChartSeries(withHiddenSecond, spec.series[0]!.id)).toBe(false);
    expect(toggleChartSeries(withHiddenSecond, spec.series[0]!.id)).toBe(withHiddenSecond);

    const restored = toggleChartSeries(withHiddenSecond, spec.series[1]!.id);
    expect(projectVisibleChartSeries(restored, [], resolved).map((series) => series.id))
      .toEqual(spec.series.map((series) => series.id));
  });

  test("includes volume in fresh price and followed-ticker defaults", () => {
    const price = buildPriceChartPreset("AAPL");
    const followed = buildCustomChartPreset("", "AAPL");

    expect(getSelectedBuiltinStudies(price)).toEqual(["volume"]);
    expect(price.panels.find((panel) => panel.id === "volume")).toMatchObject({
      label: "Volume",
      height: 0.24,
    });
    expect(followed).toEqual(price);
  });

  test("forces raw values when a series changes to an OHLC presentation", () => {
    const price = buildPriceChartPreset("AAPL").series[0]!;
    const transformed = { ...price, style: "line" as const, transform: "percent" as const };
    expect(applySeriesStyle(transformed, "candles")).toMatchObject({
      style: "candles",
      transform: "raw",
    });
  });

  test("keeps financial timing independent from visual style", () => {
    const revenue = buildCustomChartPreset("AAPL:revenue").series[0]!;
    const line = applySeriesStyle(revenue, "line");
    const available = applySeriesTimestampMode(revenue, "available-at");
    const columns = applySeriesStyle(available, "columns");

    expect(line.interpolation).toBe("none");
    expect(line.source).toMatchObject({ timestampMode: "period-end" });
    expect(columns.interpolation).toBe("none");
    expect(columns.source).toMatchObject({ timestampMode: "available-at" });
    expect(applySeriesStyle(columns, "line")).toMatchObject({
      interpolation: "none",
      source: {
        timestampMode: "available-at",
      },
    });
  });

  test("rebinds followed research symbols without resetting authored chart state", () => {
    const price = buildPriceChartPreset("AAPL");
    const customized = setBuiltinStudies({
      ...price,
      viewport: { range: "3M", resolution: "1h" },
      series: [
        { ...price.series[0]!, style: "line", transform: "percent", label: "AAPL" },
        buildCustomChartPreset("MSFT:revenue").series[0]!,
      ],
    }, ["sma20"]);

    const rebound = rebindChartSecuritySymbol(customized, "AAPL", "NVDA");
    expect(rebound.viewport).toEqual(customized.viewport);
    expect(rebound.studies).toEqual(customized.studies);
    expect(rebound.series[0]).toMatchObject({
      style: "line",
      transform: "percent",
      label: "NVDA",
      source: { instrument: { symbol: "NVDA" } },
    });
    expect(rebound.series[1]).toEqual(customized.series[1]);
  });

  test("binds pair formulas to the first two visible series after reordering", () => {
    const comparison = buildComparisonChartPreset(["AAPL", "MSFT", "NVDA"]);
    const withFormulas = setPairStudies(comparison, ["ratio", "correlation"]);
    const firstInputs = withFormulas.series.slice(0, 2).map((series) => series.id);
    expect(withFormulas.studies.map((study) => study.inputSeriesIds)).toEqual([
      firstInputs,
      firstInputs,
    ]);

    const reordered = {
      ...withFormulas,
      series: [withFormulas.series[2]!, withFormulas.series[0]!, withFormulas.series[1]!],
    };
    const rebound = setPairStudies(reordered, getSelectedPairStudies(reordered));
    const reorderedInputs = rebound.series.slice(0, 2).map((series) => series.id);
    expect(rebound.studies.map((study) => study.inputSeriesIds)).toEqual([
      reorderedInputs,
      reorderedInputs,
    ]);
  });

  test("preserves user-authored panel settings when indicators and formulas change", () => {
    const comparison = buildComparisonChartPreset(["AAPL", "MSFT"]);
    const customized = {
      ...comparison,
      panels: [
        { id: "main", label: "Relative performance", height: 0.72, scale: "log" as const },
        { id: "notes", label: "Reserved", height: 0.4 },
      ],
    };

    const withIndicators = setBuiltinStudies(customized, ["rsi14"]);
    expect(getSelectedBuiltinStudies(withIndicators)).toEqual(["rsi14"]);
    expect(withIndicators.panels[0]).toEqual({
      id: "main",
      label: "Relative performance",
      height: 0.72,
      scale: "log",
    });
    expect(withIndicators.panels.find((panel) => panel.id === "rsi")).toMatchObject({
      label: "RSI",
      height: 0.28,
    });
    expect(withIndicators.panels).toContainEqual({
      id: "notes",
      label: "Reserved",
      height: 0.4,
    });

    const withFormula = setPairStudies(withIndicators, ["ratio"]);
    expect(withFormula.panels[0]).toEqual(withIndicators.panels[0]);
    expect(withFormula.panels.find((panel) => panel.id === "rsi")).toEqual(
      withIndicators.panels.find((panel) => panel.id === "rsi"),
    );

    const customizedFormula = {
      ...withFormula,
      panels: withFormula.panels.map((panel) => panel.id === "formula"
        ? { ...panel, label: "Custom ratio", height: 0.41, scale: "log" as const }
        : panel),
    };
    const rebound = setPairStudies(customizedFormula, getSelectedPairStudies(customizedFormula));
    expect(rebound.panels.find((panel) => panel.id === "formula")).toEqual({
      id: "formula",
      label: "Custom ratio",
      height: 0.41,
      scale: "log",
    });

    const withoutManagedStudies = setPairStudies(setBuiltinStudies(rebound, []), []);
    expect(withoutManagedStudies.panels.some((panel) => panel.id === "rsi")).toBe(false);
    expect(withoutManagedStudies.panels.some((panel) => panel.id === "formula")).toBe(false);
    expect(withoutManagedStudies.panels).toContainEqual({
      id: "notes",
      label: "Reserved",
      height: 0.4,
    });
  });
});

describe("chart composer spec persistence", () => {
  test("normalizes aliases and incompatible presentation on parse", () => {
    const authored = buildCustomChartPreset("MSFT:revenue");
    const series = authored.series[0]!;
    const parsed = parseChartSpec({
      ...authored,
      series: [{
        ...series,
        source: { ...series.source, fieldId: "revenue" },
        style: "candles",
      }],
    });

    expect(parsed?.series[0]).toMatchObject({
      style: "columns",
      source: { kind: "security", fieldId: "fundamental.totalRevenue" },
    });
    expect(parsed?.panels[0]?.scale).toBe("linear");
  });

  test("round-trips a valid spec and rejects malformed semantic references", () => {
    const valid = setPairStudies(
      buildComparisonChartPreset(["AAPL", "MSFT"]),
      ["spread"],
    );
    expect(parseChartSpec(serializeChartSpec(valid))).toEqual(parseChartSpec(valid));
    expect(parseChartSpec("not json")).toBeNull();

    const price = buildPriceChartPreset("AAPL");
    expect(parseChartSpec({
      ...price,
      panels: [...price.panels, { id: "formula" }],
      studies: [{
        id: "bad-ratio",
        kind: "ratio",
        inputSeriesIds: [price.series[0]!.id],
        parameters: {},
        panelId: "formula",
        axis: "auto",
      }],
    })).toBeNull();
  });

  test("round-trips independent financial style and timing choices", () => {
    const base = buildCustomChartPreset("AAPL:revenue, MSFT:revenue");
    const authored = {
      ...base,
      series: [
        applySeriesStyle(base.series[0]!, "line"),
        applySeriesTimestampMode(
          applySeriesStyle(base.series[1]!, "columns"),
          "available-at",
        ),
      ],
    };

    const parsed = parseChartSpec(serializeChartSpec(authored));
    expect(parsed?.series.map((series) => ({
      style: series.style,
      timestampMode: series.source.kind === "security" ? series.source.timestampMode : undefined,
    }))).toEqual([
      { style: "line", timestampMode: "period-end" },
      { style: "columns", timestampMode: "available-at" },
    ]);
  });

  test("migrates v1 security and economic specs but never treats v1 as capability-aware", () => {
    const legacy = buildCustomChartPreset("AAPL:price, FRED:CPIAUCSL");
    const migrated = parseChartSpec({ ...legacy, version: 1 });
    expect(migrated?.version).toBe(2);
    expect(migrated?.series.map((series) => series.source.kind)).toEqual(["security", "economic"]);

    const capability = buildCustomChartPreset("CAP:prediction-markets.series:polymarket/event-1/market-1");
    expect(parseChartSpec({ ...capability, version: 1 })).toBeNull();
    expect(parseChartSpec(serializeChartSpec(capability))).toEqual(parseChartSpec(capability));
  });

  test("rejects chart specs authored by a newer unsupported version", () => {
    const current = buildPriceChartPreset("AAPL");
    expect(parseChartSpec({ ...current, version: current.version + 1 })).toBeNull();
    expect(parseChartSpec({ ...current, version: String(current.version + 1) })).toBeNull();
  });
});

describe("chart composer CLI options", () => {
  test("applies price and financial options to the persisted spec", () => {
    const candle = applyChartComposerCapabilityOptions(
      buildPriceChartPreset("AAPL"),
      "price-chart",
      { axisMode: "percent" },
    );
    expect(candle.series[0]).toMatchObject({ style: "candles", transform: "raw" });

    const comparison = applyChartComposerCapabilityOptions(
      buildComparisonChartPreset(["AAPL", "MSFT"]),
      "price-comparison",
      { rangePreset: "3M", chartResolution: "1h", axisMode: "price" },
    );
    expect(comparison.viewport).toMatchObject({ range: "3M", resolution: "1h" });
    expect(comparison.series.every((series) => series.transform === "raw")).toBe(true);

    const initialFinancial = buildCustomChartPreset("AAPL:revenue");
    const financial = applyChartComposerCapabilityOptions(
      {
        ...initialFinancial,
        series: [
          applySeriesTimestampMode(initialFinancial.series[0]!, "available-at"),
        ],
      },
      "fundamental-series",
      { metric: "freeCashFlow", period: "annual", periods: 6 },
    );
    expect(financial.viewport.maxPoints).toBe(6);
    expect(financial.series[0]?.source).toMatchObject({
      kind: "security",
      fieldId: "fundamental.freeCashFlow",
      period: "annual",
      timestampMode: "available-at",
    });
  });
});
