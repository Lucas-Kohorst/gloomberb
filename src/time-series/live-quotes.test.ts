import { describe, expect, test } from "bun:test";
import { createTestDataProvider } from "../test-support/data-provider";
import type { Quote } from "../types/financials";
import {
  CHART_SPEC_VERSION,
  type ChartResolutionResult,
  type ChartSeriesSpec,
  type ChartSpec,
  type ResolvedSeries,
} from "./types";
import {
  chartQuoteOverrideKeyForSource,
  chartQuoteOverrideKeyForTarget,
  getLiveChartQuoteTargets,
  patchResolvedChartWithLiveQuotes,
  subscribeToLiveChartQuotes,
} from "./live-quotes";
import { appendLiveQuotePoint } from "./chart-data";
import { CHART_RESOLUTION_STEP_MS } from "./resolution";

function securitySeries(
  id: string,
  symbol: string,
  fieldId: string,
  visible = true,
): ChartSeriesSpec {
  return {
    id,
    source: { kind: "security", instrument: { symbol }, fieldId },
    style: "line",
    transform: "raw",
    axis: "auto",
    panelId: "main",
    interpolation: "none",
    visible,
  };
}

function specWithSeries(series: ChartSeriesSpec[]): ChartSpec {
  return {
    version: CHART_SPEC_VERSION,
    viewport: { range: "1Y", resolution: "1d" },
    panels: [{ id: "main" }],
    series,
    studies: [],
  };
}

function quote(symbol: string, price: number, lastUpdated: number): Quote {
  return {
    symbol,
    price,
    currency: "USD",
    change: 0,
    changePercent: 0,
    lastUpdated,
  };
}

function resolvedPriceSeries(overrides: Partial<ResolvedSeries> = {}): ResolvedSeries {
  const first = {
    date: new Date("2026-05-15T20:20:00.000Z"),
    observedAt: new Date("2026-05-15T20:20:00.000Z"),
    value: 124,
    open: 122,
    high: 125,
    low: 121,
    close: 124,
  };
  const last = {
    date: new Date("2026-05-15T20:25:00.000Z"),
    observedAt: new Date("2026-05-15T20:25:00.000Z"),
    value: 126,
    open: 124,
    high: 130,
    low: 122,
    close: 126,
  };
  return {
    id: "price",
    label: "AAPL",
    color: "#4dabf7",
    unit: "USD/share",
    unitGroup: "price",
    nativeFrequency: "daily",
    dataShape: "ohlcv",
    style: "candles",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    timeBasis: { kind: "market", timeZone: "America/New_York", cadenceMs: CHART_RESOLUTION_STEP_MS["5m"] },
    points: [first, last],
    ...overrides,
  };
}

function resolvedChart(series: ResolvedSeries[] = [resolvedPriceSeries()]): ChartResolutionResult {
  return {
    series,
    legendSeries: series,
    bufferedSeries: series,
    loading: false,
    errors: [],
    warnings: [],
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for live quote refresh.");
}

describe("live chart quotes", () => {
  test("subscribes only to visible quote-sensitive instruments and deduplicates them", () => {
    const spec = specWithSeries([
      securitySeries("aapl-close", "AAPL", "market.close"),
      securitySeries("aapl-volume", "AAPL", "market.volume"),
      securitySeries("hidden", "MSFT", "market.close", false),
      securitySeries("fundamental", "GOOG", "fundamental.totalRevenue"),
      securitySeries("valuation", "TSLA", "pe"),
      securitySeries("price-sales", "SHOP", "valuation.priceSales"),
      securitySeries("forward-pe", "NVDA", "valuation.forwardPE"),
      securitySeries("peg", "META", "valuation.pegRatio"),
      {
        id: "fred",
        source: { kind: "economic", provider: "fred", seriesId: "CPIAUCSL" },
        style: "line",
        transform: "raw",
        axis: "auto",
        panelId: "main",
        interpolation: "none",
      },
    ]);

    expect(getLiveChartQuoteTargets(spec).map((target) => target.symbol)).toEqual(["AAPL", "TSLA", "SHOP"]);
  });

  test("subscribes to a hidden quote series when a visible study depends on it", () => {
    const spec = specWithSeries([
      securitySeries("hidden-price", "MSFT", "market.close", false),
    ]);
    spec.studies = [{
      id: "sma",
      kind: "sma",
      inputSeriesIds: ["hidden-price"],
      parameters: { period: 20 },
      panelId: "main",
      axis: "auto",
    }];

    expect(getLiveChartQuoteTargets(spec).map((target) => target.symbol)).toEqual(["MSFT"]);
  });

  test("coalesces bursts, serializes refreshes, and stops cleanly", async () => {
    const spec = specWithSeries([securitySeries("price", "AAPL", "market.close")]);
    let handler: Parameters<NonNullable<ReturnType<typeof createTestDataProvider>["subscribeQuotes"]>>[1]
      | undefined;
    let subscribedTarget: Parameters<NonNullable<ReturnType<typeof createTestDataProvider>["subscribeQuotes"]>>[0][number]
      | undefined;
    let unsubscribeCalls = 0;
    const provider = createTestDataProvider({
      subscribeQuotes: (targets, onQuote) => {
        subscribedTarget = targets[0];
        handler = onQuote;
        return () => {
          unsubscribeCalls += 1;
        };
      },
    });
    let releaseFirst!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const snapshots: Array<ReadonlyMap<string, Quote>> = [];
    const dispose = subscribeToLiveChartQuotes({
      spec,
      dataProvider: provider,
      refreshIntervalMs: 0,
      onRefresh: async (overrides) => {
        snapshots.push(overrides);
        if (snapshots.length === 1) await firstRefresh;
      },
    });
    const key = chartQuoteOverrideKeyForTarget(subscribedTarget!);

    handler!(subscribedTarget!, quote("AAPL", 100, 100));
    handler!(subscribedTarget!, quote("AAPL", 101, 101));
    await waitFor(() => snapshots.length === 1);
    expect(snapshots[0]?.get(key)?.price).toBe(101);

    handler!(subscribedTarget!, quote("AAPL", 102, 102));
    handler!(subscribedTarget!, quote("AAPL", 99, 99));
    handler!(subscribedTarget!, quote("AAPL", 103, 103));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(snapshots).toHaveLength(1);

    releaseFirst();
    await waitFor(() => snapshots.length === 2);
    expect(snapshots[1]?.get(key)?.price).toBe(103);

    dispose();
    dispose();
    expect(unsubscribeCalls).toBe(1);
    handler!(subscribedTarget!, quote("AAPL", 104, 104));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(snapshots).toHaveLength(2);
  });

  test("does not refresh resolved charts for receivedAt-only quote updates", async () => {
    const spec = specWithSeries([securitySeries("price", "AAPL", "market.close")]);
    let handler: Parameters<NonNullable<ReturnType<typeof createTestDataProvider>["subscribeQuotes"]>>[1]
      | undefined;
    let target: Parameters<NonNullable<ReturnType<typeof createTestDataProvider>["subscribeQuotes"]>>[0][number]
      | undefined;
    const provider = createTestDataProvider({
      subscribeQuotes: (targets, onQuote) => {
        target = targets[0];
        handler = onQuote;
        return () => {};
      },
    });
    let refreshCalls = 0;
    const dispose = subscribeToLiveChartQuotes({
      spec,
      dataProvider: provider,
      refreshIntervalMs: 0,
      onRefresh: () => {
        refreshCalls += 1;
      },
    });

    handler!(target!, { ...quote("AAPL", 100, 100), receivedAt: 100 });
    await waitFor(() => refreshCalls === 1);
    handler!(target!, { ...quote("AAPL", 100, 100), receivedAt: 101 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(refreshCalls).toBe(1);

    handler!(target!, { ...quote("AAPL", 101, 100), receivedAt: 102 });
    await waitFor(() => refreshCalls === 2);
    dispose();
  });

  test("continues after a synchronous background refresh failure", async () => {
    const spec = specWithSeries([securitySeries("price", "AAPL", "market.close")]);
    let handler: Parameters<NonNullable<ReturnType<typeof createTestDataProvider>["subscribeQuotes"]>>[1]
      | undefined;
    let target: Parameters<NonNullable<ReturnType<typeof createTestDataProvider>["subscribeQuotes"]>>[0][number]
      | undefined;
    const provider = createTestDataProvider({
      subscribeQuotes: (targets, onQuote) => {
        target = targets[0];
        handler = onQuote;
        return () => {};
      },
    });
    let refreshCalls = 0;
    const dispose = subscribeToLiveChartQuotes({
      spec,
      dataProvider: provider,
      refreshIntervalMs: 0,
      onRefresh: () => {
        refreshCalls += 1;
        if (refreshCalls === 1) throw new Error("temporary failure");
      },
    });

    handler!(target!, quote("AAPL", 100, 100));
    await waitFor(() => refreshCalls === 1);
    handler!(target!, quote("AAPL", 101, 101));
    await waitFor(() => refreshCalls === 2);

    dispose();
  });

  test("patches the last candle from a live quote without adding a bar", () => {
    const spec = specWithSeries([securitySeries("price", "AAPL", "market.ohlcv")]);
    spec.series[0]!.style = "candles";
    spec.viewport = { range: "1D", resolution: "5m" };
    const series = resolvedPriceSeries();
    const first = series.points[0]!;
    const chart = resolvedChart([series]);
    const key = chartQuoteOverrideKeyForSource({
      kind: "security",
      instrument: { symbol: "AAPL" },
      fieldId: "market.ohlcv",
    });
    const now = Date.parse("2026-05-15T20:29:00.000Z");
    const patched = patchResolvedChartWithLiveQuotes(
      chart,
      spec,
      new Map([[key, quote("AAPL", 129, now)]]),
      now,
    );

    expect(patched).not.toBeNull();
    expect(patched).not.toBe(chart);
    expect(patched?.series[0]?.points[0]).toBe(first);
    expect(patched?.series[0]?.points).toHaveLength(2);
    expect(patched?.series[0]?.points.at(-1)).toMatchObject({
      close: 129,
      high: 130,
      low: 122,
      open: 124,
      value: 129,
    });
    expect(patched?.bufferedSeries?.[0]?.points.at(-1)?.close).toBe(129);
  });

  test("reuses chart history when a live quote does not move the active bar", () => {
    const history = [{
      date: new Date("2026-05-15T20:25:00.000Z"),
      open: 124,
      high: 130,
      low: 122,
      close: 126,
    }];
    const next = appendLiveQuotePoint(
      history,
      quote("AAPL", 126, Date.parse("2026-05-15T20:29:00.000Z")),
      {
        now: Date.parse("2026-05-15T20:30:00.000Z"),
        mode: "ohlc",
        resolution: "5m",
      },
    );
    expect(next).toBe(history);
  });

  test("does not patch when a quote belongs to a new bar", () => {
    const spec = specWithSeries([securitySeries("price", "AAPL", "market.ohlcv")]);
    spec.series[0]!.style = "candles";
    spec.viewport = { range: "1D", resolution: "5m" };
    const key = chartQuoteOverrideKeyForSource({
      kind: "security",
      instrument: { symbol: "AAPL" },
      fieldId: "market.ohlcv",
    });
    const now = Date.parse("2026-05-15T20:31:00.000Z");
    expect(patchResolvedChartWithLiveQuotes(
      resolvedChart(),
      spec,
      new Map([[key, quote("AAPL", 129, Date.parse("2026-05-15T20:30:00.000Z"))]]),
      now,
    )).toBeNull();
  });

  test("patches last print on a raw line chart and skips SMA studies", () => {
    const lineSpec = specWithSeries([securitySeries("price", "AAPL", "market.close")]);
    lineSpec.viewport = { range: "1Y", resolution: "1d" };
    const lineSeries = resolvedPriceSeries({
      style: "line",
      dataShape: "scalar",
      timeBasis: { kind: "market", timeZone: "America/New_York", cadenceMs: CHART_RESOLUTION_STEP_MS["1d"] },
      points: [{
        date: new Date("2026-05-15T20:00:00.000Z"),
        observedAt: new Date("2026-05-15T20:00:00.000Z"),
        value: 126,
        close: 126,
      }],
    });
    const key = chartQuoteOverrideKeyForSource({
      kind: "security",
      instrument: { symbol: "AAPL" },
      fieldId: "market.close",
    });
    const now = Date.parse("2026-05-15T20:30:00.000Z");
    const patched = patchResolvedChartWithLiveQuotes(
      resolvedChart([lineSeries]),
      lineSpec,
      new Map([[key, { ...quote("AAPL", 129, now), changePercent: 2.4 }]]),
      now,
    );
    expect(patched?.series[0]?.points.at(-1)?.value).toBe(129);
    expect(patched?.series[0]?.latestChangePercent).toBe(2.4);

    const smaSpec = specWithSeries([securitySeries("price", "AAPL", "market.ohlcv")]);
    smaSpec.series[0]!.style = "candles";
    smaSpec.studies = [{
      id: "sma",
      kind: "sma",
      inputSeriesIds: ["price"],
      parameters: { period: 20 },
      panelId: "main",
      axis: "auto",
    }];
    expect(patchResolvedChartWithLiveQuotes(
      resolvedChart(),
      smaSpec,
      new Map([[key, quote("AAPL", 129, now)]]),
      now,
    )).toBeNull();
  });

  test("patches candles when the only study is volume", () => {
    const spec = specWithSeries([securitySeries("price", "AAPL", "market.ohlcv")]);
    spec.series[0]!.style = "candles";
    spec.viewport = { range: "1D", resolution: "5m" };
    spec.studies = [{
      id: "volume",
      kind: "volume",
      inputSeriesIds: ["price"],
      parameters: {},
      panelId: "volume",
      axis: "auto",
    }];
    const key = chartQuoteOverrideKeyForSource({
      kind: "security",
      instrument: { symbol: "AAPL" },
      fieldId: "market.ohlcv",
    });
    const now = Date.parse("2026-05-15T20:29:00.000Z");
    const patched = patchResolvedChartWithLiveQuotes(
      resolvedChart(),
      spec,
      new Map([[key, quote("AAPL", 129, now)]]),
      now,
    );
    expect(patched?.series[0]?.points.at(-1)?.close).toBe(129);
  });
});
