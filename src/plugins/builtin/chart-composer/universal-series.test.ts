import { describe, expect, test } from "bun:test";
import {
  parseSeriesExpression,
  parseChartExpression,
  buildSeriesSpec,
  formatSeriesExpression,
  chartSeriesLabel,
  buildCustomChartPreset,
} from "./presets";
import {
  formatParsedSeriesExpression,
  buildSeriesCatalogSuggestions,
  buildChartSeriesAssistContext,
} from "./series-catalog";
import {
  FUTURES_CATALOG,
  TREASURY_CATALOG,
  BENCHMARK_METRICS,
  findFuturesCatalogEntry,
  findTreasuryCatalogEntry,
  findBenchmarkMetric,
} from "./universal-series";

const AAPL = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };

describe("universal series expression parsing", () => {
  test("parses ADJ:indexId", () => {
    expect(parseSeriesExpression("ADJ:adjacent-djt")).toEqual({
      kind: "adjacent-index",
      indexId: "adjacent-djt",
    });
    // case-insensitive prefix, lowercase index id
    expect(parseSeriesExpression("adj:MyIndex")).toEqual({
      kind: "adjacent-index",
      indexId: "myindex",
    });
  });

  test("parses FUT:code and resolves to the Yahoo symbol", () => {
    expect(parseSeriesExpression("FUT:ES")).toEqual({
      kind: "future",
      code: "ES",
      symbol: "ES=F",
      name: "E-Mini S&P 500",
      label: "E-Mini S&P 500",
    });
    // also accepts the raw Yahoo symbol
    expect(parseSeriesExpression("FUT:ES=F")).toEqual({
      kind: "future",
      code: "ES",
      symbol: "ES=F",
      name: "E-Mini S&P 500",
      label: "E-Mini S&P 500",
    });
  });

  test("rejects an unknown futures code", () => {
    expect(parseSeriesExpression("FUT:ZZZ")).toBeNull();
  });

  test("parses UST:maturity and resolves to the FRED series id", () => {
    expect(parseSeriesExpression("UST:10Y")).toEqual({
      kind: "treasury-yield",
      maturity: "10Y",
      seriesId: "DGS10",
      label: "10Y Treasury Yield",
    });
    expect(parseSeriesExpression("ust:3m")).toEqual({
      kind: "treasury-yield",
      maturity: "3M",
      seriesId: "DGS3MO",
      label: "3M Treasury Yield",
    });
  });

  test("rejects an unknown treasury maturity", () => {
    expect(parseSeriesExpression("UST:99Y")).toBeNull();
  });

  test("parses BENCH:selector:metric", () => {
    expect(parseSeriesExpression("BENCH:OpenAI:tps")).toEqual({
      kind: "benchmark",
      selector: "OpenAI",
      metric: "tps",
    });
    // selector may contain spaces
    expect(parseSeriesExpression("BENCH:Some Company:p95")).toEqual({
      kind: "benchmark",
      selector: "Some Company",
      metric: "p95",
    });
  });

  test("parses POLL:subject:choice", () => {
    expect(parseSeriesExpression("POLL:Donald Trump:Approve")).toEqual({
      kind: "poll",
      subject: "Donald Trump",
      choice: "Approve",
    });
    // subject with extra colons uses the last colon as the delimiter
    expect(parseSeriesExpression("POLL:Subject:With:Colons:Choice")).toEqual({
      kind: "poll",
      subject: "Subject:With:Colons",
      choice: "Choice",
    });
  });

  test("parses KALSHI:ticker, POLY:marketId, and PM:venue:id", () => {
    expect(parseSeriesExpression("KALSHI:KXPRESPERSON")).toEqual({
      kind: "prediction-market",
      venue: "kalshi",
      marketId: "KXPRESPERSON",
    });
    expect(parseSeriesExpression("poly:fed-cut-september")).toEqual({
      kind: "prediction-market",
      venue: "polymarket",
      marketId: "fed-cut-september",
    });
    expect(parseSeriesExpression("PM:kalshi:kx-fed-cut")).toEqual({
      kind: "prediction-market",
      venue: "kalshi",
      marketId: "KX-FED-CUT",
    });
  });

  test("maps Adjacent index natural language onto ADJ:indexId", () => {
    expect(parseChartExpression("adjacent red index")).toEqual([
      { kind: "adjacent-index", indexId: "red", label: "RED Index" },
    ]);
    const spec = buildCustomChartPreset("adjacent red index");
    expect(formatSeriesExpression(spec.series[0]!)).toBe("ADJ:red");
  });

  test("parseChartExpression handles mixed universal and security series", () => {
    const parsed = parseChartExpression("AAPL:price, FUT:ES, UST:10Y, BENCH:OpenAI:tps");
    expect(parsed.map((entry) => entry.kind)).toEqual([
      "security",
      "future",
      "treasury-yield",
      "benchmark",
    ]);
  });
});

describe("universal series spec building", () => {
  test("future builds a security spec with the Yahoo symbol", () => {
    const spec = buildSeriesSpec(parseSeriesExpression("FUT:ES")!, 0);
    expect(spec.source).toEqual({
      kind: "security",
      instrument: { symbol: "ES=F" },
      fieldId: "market.ohlcv",
      period: "auto",
    });
    expect(spec.label).toBe("E-Mini S&P 500");
    expect(spec.style).toBe("candles");
  });

  test("treasury-yield builds an economic spec with the FRED series id", () => {
    const spec = buildSeriesSpec(parseSeriesExpression("UST:10Y")!, 0);
    expect(spec.source).toEqual({
      kind: "economic",
      provider: "fred",
      seriesId: "DGS10",
    });
    expect(spec.label).toBe("10Y Treasury Yield");
    expect(spec.style).toBe("step");
  });

  test("adjacent-index builds a source with the new kind", () => {
    const spec = buildSeriesSpec(parseSeriesExpression("ADJ:adjacent-djt")!, 0);
    expect(spec.source).toEqual({
      kind: "adjacent-index",
      indexId: "adjacent-djt",
    });
    expect(spec.style).toBe("line");
  });

  test("benchmark defaults to points style", () => {
    const spec = buildSeriesSpec(parseSeriesExpression("BENCH:OpenAI:tps")!, 0);
    expect(spec.source).toEqual({
      kind: "benchmark",
      selector: "OpenAI",
      metric: "tps",
    });
    expect(spec.style).toBe("points");
  });

  test("poll builds a source with subject and choice", () => {
    const spec = buildSeriesSpec(parseSeriesExpression("POLL:Donald Trump:Approve")!, 0);
    expect(spec.source).toEqual({
      kind: "poll",
      subject: "Donald Trump",
      choice: "Approve",
    });
    expect(spec.style).toBe("line");
  });

  test("prediction-market builds a kalshi/polymarket source", () => {
    const spec = buildSeriesSpec(parseSeriesExpression("KALSHI:KXPRESPERSON")!, 0);
    expect(spec.source).toEqual({
      kind: "prediction-market",
      venue: "kalshi",
      marketId: "KXPRESPERSON",
    });
    expect(spec.style).toBe("line");
    expect(formatSeriesExpression(spec)).toBe("KALSHI:KXPRESPERSON");
  });
});

describe("universal series formatting and labels", () => {
  test("formatParsedSeriesExpression round-trips each kind", () => {
    expect(formatParsedSeriesExpression(parseSeriesExpression("ADJ:adjacent-djt")!))
      .toBe("ADJ:adjacent-djt");
    expect(formatParsedSeriesExpression(parseSeriesExpression("FUT:ES")!))
      .toBe("FUT:ES");
    expect(formatParsedSeriesExpression(parseSeriesExpression("UST:10Y")!))
      .toBe("UST:10Y");
    expect(formatParsedSeriesExpression(parseSeriesExpression("BENCH:OpenAI:tps")!))
      .toBe("BENCH:OpenAI:tps");
    expect(formatParsedSeriesExpression(parseSeriesExpression("POLL:Donald Trump:Approve")!))
      .toBe("POLL:Donald Trump:Approve");
    expect(formatParsedSeriesExpression(parseSeriesExpression("KALSHI:KXPRESPERSON")!))
      .toBe("KALSHI:KXPRESPERSON");
    expect(formatParsedSeriesExpression(parseSeriesExpression("POLY:fed-cut-september")!))
      .toBe("POLY:fed-cut-september");
  });

  test("formatSeriesExpression and chartSeriesLabel handle stored specs", () => {
    const spec = buildCustomChartPreset("ADJ:adjacent-djt, BENCH:OpenAI:tps");
    expect(spec.series).toHaveLength(2);
    expect(formatSeriesExpression(spec.series[0]!)).toBe("ADJ:adjacent-djt");
    expect(chartSeriesLabel(spec.series[0]!)).toBe("ADJ adjacent-djt");
    expect(formatSeriesExpression(spec.series[1]!)).toBe("BENCH:OpenAI:tps");
    expect(chartSeriesLabel(spec.series[1]!)).toBe("OpenAI tps");
  });

  test("FUT spec formats as the underlying security symbol", () => {
    const spec = buildCustomChartPreset("FUT:ES");
    // Stored as a security — expression shows the Yahoo symbol.
    expect(formatSeriesExpression(spec.series[0]!)).toBe("ES=F:market.ohlcv");
    // Label preserves the human name.
    expect(chartSeriesLabel(spec.series[0]!)).toBe("E-Mini S&P 500");
  });

  test("UST spec formats as the underlying FRED series", () => {
    const spec = buildCustomChartPreset("UST:10Y");
    expect(formatSeriesExpression(spec.series[0]!)).toBe("FRED:DGS10");
    expect(chartSeriesLabel(spec.series[0]!)).toBe("10Y Treasury Yield");
  });
});

describe("universal series catalog suggestions", () => {
  test("suggests futures when the query matches a contract name or code", () => {
    const suggestions = buildSeriesCatalogSuggestions("gold", AAPL);
    const fut = suggestions.find((entry) => entry.expression.kind === "future");
    expect(fut).toBeDefined();
    expect(fut!.label).toContain("Gold");
  });

  test("suggests treasuries when the query matches a maturity or 'yield'", () => {
    const suggestions = buildSeriesCatalogSuggestions("treasury yield", AAPL);
    const treasuries = suggestions.filter((entry) => entry.expression.kind === "treasury-yield");
    expect(treasuries.length).toBeGreaterThan(0);
  });

  test("suggests benchmarks when the query matches an org or 'benchmark'", () => {
    const suggestions = buildSeriesCatalogSuggestions("benchmark openai", AAPL);
    const benches = suggestions.filter((entry) => entry.expression.kind === "benchmark");
    expect(benches.length).toBeGreaterThan(0);
    expect(benches.some((entry) => entry.label.includes("OpenAI"))).toBe(true);
  });

  test("suggests Adjacent indices from natural language", () => {
    const suggestions = buildSeriesCatalogSuggestions("adjacent red index", AAPL);
    expect(suggestions[0]?.expression).toMatchObject({
      kind: "adjacent-index",
      indexId: "red",
    });
  });

  test("suggests Kalshi series from a search hit", () => {
    const suggestions = buildSeriesCatalogSuggestions(
      "trump kalshi",
      AAPL,
      [],
      8,
      [{ venue: "kalshi", marketId: "KXPRESPERSON", title: "Will Trump win?" }],
    );
    expect(suggestions[0]?.expression).toMatchObject({
      kind: "prediction-market",
      venue: "kalshi",
      marketId: "KXPRESPERSON",
    });
    expect(formatParsedSeriesExpression(suggestions[0]!.expression)).toBe("KALSHI:KXPRESPERSON");
  });

  test("suggests polls when the query matches 'poll' or a subject", () => {
    const suggestions = buildSeriesCatalogSuggestions("poll approval", AAPL, [], 12);
    const polls = suggestions.filter((entry) => entry.expression.kind === "poll");
    expect(polls.length).toBeGreaterThan(0);
  });

  test("exact prefix expressions are recognized as suggestions", () => {
    expect(buildSeriesCatalogSuggestions("FUT:ES", AAPL)[0]).toMatchObject({
      expression: { kind: "future", code: "ES" },
    });
    expect(buildSeriesCatalogSuggestions("UST:10Y", AAPL)[0]).toMatchObject({
      expression: { kind: "treasury-yield", maturity: "10Y" },
    });
    expect(buildSeriesCatalogSuggestions("ADJ:my-index", AAPL)[0]).toMatchObject({
      expression: { kind: "adjacent-index", indexId: "my-index" },
    });
    expect(buildSeriesCatalogSuggestions("KALSHI:KXPRESPERSON", AAPL)[0]).toMatchObject({
      expression: { kind: "prediction-market", venue: "kalshi", marketId: "KXPRESPERSON" },
    });
  });

  test("assist context mentions all universal prefixes", () => {
    const ctx = buildChartSeriesAssistContext();
    expect(ctx).toContain("ADJ:");
    expect(ctx).toContain("KALSHI:");
    expect(ctx).toContain("POLY:");
    expect(ctx).toContain("FUT:");
    expect(ctx).toContain("UST:");
    expect(ctx).toContain("BENCH:");
    expect(ctx).toContain("POLL:");
  });
});

describe("universal series catalog data integrity", () => {
  test("every futures catalog entry resolves via findFuturesCatalogEntry", () => {
    for (const entry of FUTURES_CATALOG) {
      expect(findFuturesCatalogEntry(entry.code)?.symbol).toBe(entry.symbol);
    }
  });

  test("every treasury catalog entry resolves via findTreasuryCatalogEntry", () => {
    for (const entry of TREASURY_CATALOG) {
      expect(findTreasuryCatalogEntry(entry.maturity)?.seriesId).toBe(entry.seriesId);
    }
  });

  test("every benchmark metric resolves via findBenchmarkMetric", () => {
    for (const metric of BENCHMARK_METRICS) {
      expect(findBenchmarkMetric(metric.code)?.label).toBe(metric.label);
    }
  });
});
