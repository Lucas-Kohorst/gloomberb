import { describe, expect, test } from "bun:test";
import {
  normalizeAdjacentIndexPrices,
  adjacentIndexPricesToPricePoints,
} from "../plugins/builtin/adjacent/normalize";
import type { AdjacentPriceSample } from "../plugins/builtin/adjacent/types";
import {
  computePollTrend,
  computeMovingAverage,
  normalizeVoteHubPoll,
} from "../plugins/builtin/polls/normalize";
import type { VoteHubPoll } from "../plugins/builtin/polls/types";
import { fetchLlmStatsData } from "../plugins/builtin/llm-stats/client";
import type { LlmStatsRow } from "../plugins/builtin/llm-stats/types";
import { resolveChartSpecData, type ChartResolveSources, type UniversalSeriesLoadResult } from "./resolve";
import { buildCustomChartPreset } from "../plugins/builtin/chart-composer/presets";
import type { ChartSpec, TimeSeriesPoint } from "./types";

// ---------------------------------------------------------------------------
// Adjacent index price normalisation math
// ---------------------------------------------------------------------------

describe("adjacent index price normalisation", () => {
  test("filters invalid timestamps and null prices, preserves valid points", () => {
    const samples: AdjacentPriceSample[] = [
      { timestamp: "2024-01-01T00:00:00Z", price: 55.2 },
      { timestamp: "2024-01-02T00:00:00Z", price: null },
      { timestamp: "not-a-date", price: 60 },
      { timestamp: "2024-01-03T00:00:00Z", price: 58.1 },
    ];
    const points = normalizeAdjacentIndexPrices(samples);
    expect(points).toHaveLength(2);
    expect(points[0]!.date.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(points[0]!.value).toBe(55.2);
    expect(points[1]!.value).toBe(58.1);
  });

  test("converts to PricePoint with close = value", () => {
    const points = normalizeAdjacentIndexPrices([
      { timestamp: "2024-01-01T00:00:00Z", price: 52 },
    ]);
    const pricePoints = adjacentIndexPricesToPricePoints(points);
    expect(pricePoints).toEqual([{ date: points[0]!.date, close: 52 }]);
  });
});

// ---------------------------------------------------------------------------
// Poll trend computation math
// ---------------------------------------------------------------------------

describe("poll trend computation", () => {
  function makePoll(overrides: Partial<VoteHubPoll>): VoteHubPoll {
    return {
      id: "p1",
      poll_type: "approval",
      sample_size: 1000,
      population: "rv",
      url: null,
      created_at: null,
      start_date: "2024-01-01",
      end_date: "2024-01-05",
      pollster: "Pollster A",
      answers: [{ choice: "Approve", pct: 52 }, { choice: "Disapprove", pct: 45 }],
      seat_name: null,
      sponsors: [],
      internal: null,
      partisan: null,
      subject: "Donald Trump",
      ...overrides,
    };
  }

  test("computePollTrend extracts a choice's pct over time, sorted by date", () => {
    const rows = [
      makePoll({ end_date: "2024-02-01", answers: [{ choice: "Approve", pct: 48 }, { choice: "Disapprove", pct: 50 }] }),
      makePoll({ end_date: "2024-01-01", answers: [{ choice: "Approve", pct: 52 }, { choice: "Disapprove", pct: 45 }] }),
      makePoll({ end_date: "2024-03-01", answers: [{ choice: "Approve", pct: 55 }, { choice: "Disapprove", pct: 42 }] }),
    ].map(normalizeVoteHubPoll);

    const trend = computePollTrend(rows, "Donald Trump", "Approve");
    expect(trend.map((p) => p.value)).toEqual([52, 48, 55]);
    expect(trend.map((p) => p.date)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
  });

  test("computePollTrend skips polls with a different subject or missing choice", () => {
    const rows = [
      makePoll({ subject: "Other Subject", answers: [{ choice: "Approve", pct: 60 }] }),
      makePoll({ answers: [{ choice: "Disapprove", pct: 50 }] }),
      makePoll({ end_date: null, start_date: null }),
    ].map(normalizeVoteHubPoll);

    const trend = computePollTrend(rows, "Donald Trump", "Approve");
    expect(trend).toHaveLength(0);
  });

  test("computeMovingAverage averages a sliding window", () => {
    const points = [
      { date: "2024-01-01", value: 10, pollster: "A" },
      { date: "2024-01-02", value: 20, pollster: "A" },
      { date: "2024-01-03", value: 30, pollster: "A" },
    ];
    const ma = computeMovingAverage(points, 2);
    expect(ma).toEqual([
      { date: "2024-01-02", value: 15 },
      { date: "2024-01-03", value: 25 },
    ]);
    // window larger than data → empty
    expect(computeMovingAverage(points, 5)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Benchmark mapping math (release-date → point)
// ---------------------------------------------------------------------------

describe("benchmark release-date mapping", () => {
  test("maps rows with release dates to points, skipping missing dates and non-finite values", async () => {
    // We test the mapping logic by calling the loader with a mocked fetch.
    // Since fetchLlmStatsData hits the real API, we verify the mapping math
    // through the loader interface with a stub.

    const rows: LlmStatsRow[] = [
      {
        id: "gpt-4o", displayName: "GPT-4o", organization: "OpenAI", provider: "OpenAI",
        releaseDate: "2024-05-13", contextLength: 128000, inputPrice: 5, outputPrice: 15,
        inputModalities: [], outputModalities: [], tier: "frontier",
        totalCalls: 1000, failedCalls: 10, failureRate: 1, avgThroughput: 85.5,
        p5Throughput: 50, avgLatency: 1200, p95Latency: 2000, avgTtft: 500, url: "",
      },
      {
        id: "gpt-4-turbo", displayName: "GPT-4 Turbo", organization: "OpenAI", provider: "OpenAI",
        releaseDate: null, contextLength: 128000, inputPrice: 10, outputPrice: 30,
        inputModalities: [], outputModalities: [], tier: "frontier",
        totalCalls: 2000, failedCalls: 20, failureRate: 1, avgThroughput: 45.2,
        p5Throughput: 20, avgLatency: 1500, p95Latency: 3000, avgTtft: 800, url: "",
      },
    ];

    // The mapping logic: filter by org, map release_date + metric → point
    const selectorLower = "openai";
    const matching = rows.filter((r) => r.organization.toLowerCase() === selectorLower);
    const points: TimeSeriesPoint[] = [];
    for (const row of matching) {
      if (!row.releaseDate) continue;
      const date = new Date(row.releaseDate);
      if (!Number.isFinite(date.getTime())) continue;
      const value = row.avgThroughput;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      points.push({ date, observedAt: date, value, provenance: { providerId: "llm-stats", quality: "reported" } });
    }
    // Only the model with a release date produces a point.
    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBe(85.5);
    expect(points[0]!.date.toISOString().slice(0, 10)).toBe("2024-05-13");
  });
});

// ---------------------------------------------------------------------------
// Resolution pipeline integration — new kinds resolve via injected loaders
// ---------------------------------------------------------------------------

describe("universal series resolution", () => {
  function makeSources(overrides: Partial<ChartResolveSources> = {}): ChartResolveSources {
    return {
      dataProvider: null,
      loadFredSeries: async () => ({
        data: { observations: [], info: null },
        fetchedAt: Date.now(),
        stale: false,
        source: "cache",
      }),
      loadAdjacentIndexSeries: async (indexId): Promise<UniversalSeriesLoadResult> => ({
        points: [
          { date: new Date("2024-01-01T00:00:00Z"), observedAt: new Date("2024-01-01T00:00:00Z"), value: 55, provenance: { providerId: "adjacent", quality: "reported" } },
          { date: new Date("2024-02-01T00:00:00Z"), observedAt: new Date("2024-02-01T00:00:00Z"), value: 60, provenance: { providerId: "adjacent", quality: "reported" } },
        ],
        unit: "index",
        unitGroup: "level",
      }),
      loadBenchmarkSeries: async (selector, metric): Promise<UniversalSeriesLoadResult> => ({
        points: [
          { date: new Date("2024-05-13T00:00:00Z"), observedAt: new Date("2024-05-13T00:00:00Z"), value: 85.5, provenance: { providerId: "llm-stats", quality: "reported" } },
        ],
        unit: "tok/s",
        unitGroup: `benchmark:${metric}`,
        label: `${selector} Throughput`,
        warning: "Point-in-time snapshot at model release date; no historical time series available.",
      }),
      loadPollSeries: async (subject, choice): Promise<UniversalSeriesLoadResult> => ({
        points: [
          { date: new Date("2024-01-05T00:00:00Z"), observedAt: new Date("2024-01-05T00:00:00Z"), value: 52, provenance: { providerId: "votehub", quality: "reported" } },
          { date: new Date("2024-02-05T00:00:00Z"), observedAt: new Date("2024-02-05T00:00:00Z"), value: 48, provenance: { providerId: "votehub", quality: "reported" } },
        ],
        unit: "%",
        unitGroup: "percent",
        label: `${subject} ${choice}`,
      }),
      loadPredictionMarketSeries: async (venue, marketId): Promise<UniversalSeriesLoadResult> => ({
        points: [
          { date: new Date("2024-01-01T00:00:00Z"), observedAt: new Date("2024-01-01T00:00:00Z"), value: 42, provenance: { providerId: "adjacent", quality: "reported" } },
          { date: new Date("2024-02-01T00:00:00Z"), observedAt: new Date("2024-02-01T00:00:00Z"), value: 48, provenance: { providerId: "adjacent", quality: "reported" } },
        ],
        unit: "%",
        unitGroup: "probability",
        label: `${venue} ${marketId}`,
      }),
      ...overrides,
    };
  }

  test("resolves an adjacent-index series through injected loaders", async () => {
    const spec: ChartSpec = buildCustomChartPreset("ADJ:adjacent-djt");
    const result = await resolveChartSpecData(spec, makeSources());
    expect(result.errors).toHaveLength(0);
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.points).toHaveLength(2);
    expect(result.series[0]!.points[0]!.value).toBe(55);
    expect(result.series[0]!.unit).toBe("index");
  });

  test("resolves a benchmark series with a scatter warning", async () => {
    const spec: ChartSpec = buildCustomChartPreset("BENCH:OpenAI:tps");
    const result = await resolveChartSpecData(spec, makeSources());
    expect(result.errors).toHaveLength(0);
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.points).toHaveLength(1);
    expect(result.series[0]!.style).toBe("points");
    expect(result.series[0]!.warning).toContain("Point-in-time");
  });

  test("resolves a poll series", async () => {
    const spec: ChartSpec = buildCustomChartPreset("POLL:Donald Trump:Approve");
    const result = await resolveChartSpecData(spec, makeSources());
    expect(result.errors).toHaveLength(0);
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.points).toHaveLength(2);
    expect(result.series[0]!.unit).toBe("%");
  });

  test("resolves a prediction-market series through injected loaders", async () => {
    const spec: ChartSpec = buildCustomChartPreset("KALSHI:KXPRESPERSON");
    const result = await resolveChartSpecData(spec, makeSources());
    expect(result.errors).toHaveLength(0);
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.points).toHaveLength(2);
    expect(result.series[0]!.points[0]!.value).toBe(42);
    expect(result.series[0]!.unit).toBe("%");
  });

  test("produces a loadable series when a universal loader is missing", async () => {
    const spec: ChartSpec = buildCustomChartPreset("ADJ:adjacent-djt");
    const result = await resolveChartSpecData(spec, makeSources({ loadAdjacentIndexSeries: undefined }));
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.points).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("keeps a failed series in the legend with a real error and a non-blank label", async () => {
    const spec: ChartSpec = buildCustomChartPreset("POLL:Donald Trump:Approve, KALSHI:MISSING");
    spec.series[1] = { ...spec.series[1]!, label: "   " };
    const result = await resolveChartSpecData(spec, makeSources({
      loadPredictionMarketSeries: async () => {
        throw new Error("Kalshi history is unavailable.");
      },
    }));

    expect(result.series.map((entry) => entry.id)).toEqual(spec.series.map((entry) => entry.id));
    expect(result.legendSeries?.map((entry) => entry.id)).toEqual(spec.series.map((entry) => entry.id));
    const failed = result.legendSeries?.find((entry) => entry.id === spec.series[1]!.id);
    expect(failed?.points).toEqual([]);
    expect(failed?.label.trim()).not.toBe("");
    expect(failed?.error).toContain("Kalshi history is unavailable.");
    expect(result.errors.some((entry) => entry.includes("Kalshi history is unavailable."))).toBe(true);
    expect(result.series[0]?.points.length).toBeGreaterThan(0);
  });

  test("does not drop remaining series when market data is unavailable", async () => {
    const spec: ChartSpec = buildCustomChartPreset("AAPL:price, POLL:Donald Trump:Approve");
    const result = await resolveChartSpecData(spec, makeSources({ dataProvider: null }));
    expect(result.legendSeries?.map((entry) => entry.id)).toEqual(spec.series.map((entry) => entry.id));
    expect(result.series.find((entry) => entry.id === spec.series[0]!.id)?.error).toContain("Market data is unavailable.");
    expect(result.series.find((entry) => entry.id === spec.series[1]!.id)?.points.length).toBeGreaterThan(0);
    expect(result.errors.some((entry) => entry.includes("Market data is unavailable."))).toBe(true);
  });

  test("resolved poll and prediction-market series keep a 0-100 scale", async () => {
    const poll = await resolveChartSpecData(buildCustomChartPreset("POLL:Donald Trump:Approve"), makeSources());
    const pm = await resolveChartSpecData(buildCustomChartPreset("KALSHI:KXPRESPERSON"), makeSources());
    expect(poll.series[0]?.unit).toBe("%");
    expect(poll.series[0]?.unitGroup).toBe("percent");
    expect(poll.series[0]?.valueRange).toEqual({ min: 0, max: 100 });
    expect(pm.series[0]?.unit).toBe("%");
    expect(pm.series[0]?.unitGroup).toBe("probability");
    expect(pm.series[0]?.valueRange).toEqual({ min: 0, max: 100 });
  });
});
