import { describe, expect, test } from "bun:test";
import { alignTimeSeries } from "./alignment";
import { extractPriceSeries } from "./market";
import { applySeriesTransform } from "./transforms";
import type { ResolvedSeries, TimeSeriesPoint } from "./types";

function point(date: string, value: number, availableAt?: string): TimeSeriesPoint {
  const observedAt = new Date(`${date}T00:00:00Z`);
  return {
    date: observedAt,
    observedAt,
    availableAt: availableAt ? new Date(`${availableAt}T00:00:00Z`) : undefined,
    value,
  };
}

function series(id: string, points: TimeSeriesPoint[], interpolation: ResolvedSeries["interpolation"]): ResolvedSeries {
  return {
    id,
    label: id,
    color: "#fff",
    unit: "value",
    unitGroup: "value",
    nativeFrequency: "quarterly",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation,
    points,
  };
}

describe("series transformations", () => {
  test("normalizes to percent and index 100 from the first nonzero observation", () => {
    const points = [point("2024-01-01", 10), point("2024-02-01", 15), point("2024-03-01", 20)];
    expect(applySeriesTransform(points, "percent").map(({ value }) => value)).toEqual([0, 50, 100]);
    expect(applySeriesTransform(points, "index100").map(({ value }) => value)).toEqual([100, 150, 200]);
    expect(points.map(({ value }) => value)).toEqual([10, 15, 20]);
  });

  test("matches QoQ and YoY by observation calendar instead of adjacent array position", () => {
    const points = [
      point("2023-03-31", 80),
      point("2023-12-31", 100),
      point("2024-03-31", 120),
      point("2024-12-31", 150),
    ];
    expect(applySeriesTransform(points, "qoq").map(({ value }) => value)).toEqual([null, null, 20, null]);
    expect(applySeriesTransform(points, "yoy").map(({ value }) => value)).toEqual([null, null, 50, 50]);
  });

  test("log transform leaves nonpositive values as gaps", () => {
    const values = applySeriesTransform([
      point("2024-01-01", -1),
      point("2024-02-01", 1),
      point("2024-03-01", Math.E),
    ], "log").map(({ value }) => value);
    expect(values[0]).toBeNull();
    expect(values[1]).toBe(0);
    expect(values[2]).toBeCloseTo(1, 12);
  });

  test("yoy returns null for every point when no observation is near the 12-month target", () => {
    const points = [
      point("2024-01-01", 100),
      point("2024-02-01", 110),
      point("2024-03-01", 120),
    ];
    expect(applySeriesTransform(points, "yoy").map(({ value }) => value)).toEqual(
      [null, null, null],
    );
  });

  test("yoy finds a reference at the exact 12-month boundary", () => {
    const points = [
      point("2023-01-01", 100),
      point("2023-02-01", 110),
      point("2023-03-01", 120),
      point("2023-04-01", 130),
      point("2023-05-01", 140),
      point("2023-06-01", 150),
      point("2023-07-01", 160),
      point("2023-08-01", 170),
      point("2023-09-01", 180),
      point("2023-10-01", 190),
      point("2023-11-01", 200),
      point("2023-12-01", 210),
      point("2024-01-01", 220),
    ];
    const values = applySeriesTransform(points, "yoy").map(({ value }) => value);
    expect(values[0]).toBeNull();
    expect(values[12]).toBeCloseTo(120, 10);
  });

  test("yoy handles 1000 daily points without timing out", () => {
    const start = new Date("2004-01-01T00:00:00Z");
    const points = Array.from({ length: 1000 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return point(iso, 100 + Math.sin(i / 10) * 10);
    });
    const result = applySeriesTransform(points, "yoy");
    expect(result).toHaveLength(1000);
    expect(result[999]!.value).not.toBeNull();
  });

  test("yoy tie-breaks duplicate timestamps by preferring the later date", () => {
    const points = [
      point("2023-06-15", 100),
      point("2024-06-15", 180),
      point("2023-06-15", 120),
      point("2024-06-15", 200),
    ];
    const values = applySeriesTransform(points, "yoy").map(({ value }) => value);
    const sortedPoints = [...points].sort(
      (a, b) => a.observedAt.getTime() - b.observedAt.getTime(),
    );
    const reference = sortedPoints.find((p) => p.observedAt.getTime() === new Date("2023-06-15T00:00:00Z").getTime());
    expect(reference).toBeDefined();
    const expected = ((200 - reference!.value) / Math.abs(reference!.value)) * 100;
    const last = values[values.length - 1];
    expect(last).toBeCloseTo(expected, 10);
  });

  test("yoy returns null when gaps exceed the tolerance window", () => {
    const points = [
      point("2022-01-01", 100),
      point("2024-06-01", 150),
    ];
    expect(applySeriesTransform(points, "yoy").map(({ value }) => value)).toEqual(
      [null, null],
    );
  });
});

describe("market aggregation", () => {
  test("uses first open, extrema, last close, and summed volume", () => {
    const points = extractPriceSeries([
      { date: new Date("2024-01-02T10:00:00Z"), open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { date: new Date("2024-01-02T16:00:00Z"), open: 11, high: 14, low: 10, close: 13, volume: 250 },
    ], {
      kind: "security",
      instrument: { symbol: "TEST" },
      fieldId: "market.ohlcv",
      period: "daily",
    });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ open: 10, high: 14, low: 9, close: 13, value: 13, volume: 350 });
  });
});

describe("mixed-frequency alignment", () => {
  test("never carries forward before availability or backward before the first point", () => {
    const sparse = series("fundamental", [
      point("2024-03-31", 40, "2024-05-15"),
    ], "step-after");
    const dates = ["2024-03-01", "2024-03-31", "2024-04-15", "2024-05-15", "2024-06-01"]
      .map((date) => new Date(`${date}T00:00:00Z`));
    const rows = alignTimeSeries([sparse], { timeline: dates });
    expect(rows.map((row) => row.values.fundamental?.value ?? null)).toEqual([null, null, null, 40, 40]);
    expect(rows[3]?.values.fundamental?.carried).toBe(false);
  });

  test("intersection keeps only timestamps where every series has a usable value", () => {
    const daily = series("price", [
      point("2024-01-01", 10),
      point("2024-01-02", 11),
      point("2024-01-03", 12),
    ], "none");
    const sparse = series("metric", [point("2024-01-02", 5)], "step-after");
    const rows = alignTimeSeries([daily, sparse], { mode: "intersection" });
    expect(rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual(["2024-01-02", "2024-01-03"]);
    expect(rows[1]?.values.metric?.carried).toBe(true);
  });
});
