import { describe, expect, test } from "bun:test";
import type { ChartSpec, ResolvedSeries, TimeSeriesPoint } from "../time-series/types";
import { buildChartSharePayload, decimateSharePoints } from "./chart-snapshot";

function point(iso: string, values: Partial<TimeSeriesPoint> = {}): TimeSeriesPoint {
  const date = new Date(iso);
  return { date, observedAt: date, value: null, ...values };
}

function series(overrides: Partial<ResolvedSeries> = {}): ResolvedSeries {
  return {
    id: "s1",
    label: "AAPL",
    color: "#ff8800",
    unit: "USD",
    unitGroup: "currency",
    nativeFrequency: "daily",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "price",
    interpolation: "none",
    points: [point("2024-01-01T00:00:00Z", { value: 1 })],
    ...overrides,
  };
}

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    version: 1,
    viewport: { range: "1Y", resolution: "auto" },
    panels: [{ id: "price" }, { id: "volume" }],
    series: [],
    studies: [],
    ...overrides,
  } as ChartSpec;
}

describe("decimateSharePoints", () => {
  test("passes short series through untouched", () => {
    const points = [{ t: 1 }, { t: 2 }, { t: 3 }];
    expect(decimateSharePoints(points, 10)).toEqual(points);
  });

  test("caps at the limit and always keeps the latest observation", () => {
    const points = Array.from({ length: 5_000 }, (_, index) => ({ t: index, v: index }));
    const capped = decimateSharePoints(points, 100);
    expect(capped).toHaveLength(100);
    expect(capped[0]!.t).toBe(0);
    expect(capped[capped.length - 1]!.t).toBe(4_999);
  });
});

describe("buildChartSharePayload", () => {
  test("carries OHLC bars and scalar values in their compact form", () => {
    const payload = buildChartSharePayload({
      title: "AAPL",
      spec: spec(),
      series: [
        series({
          id: "candles",
          style: "candles",
          points: [point("2024-01-01T00:00:00Z", { value: 2, open: 1, high: 3, low: 0.5, close: 2 })],
        }),
        series({ id: "line", points: [point("2024-01-02T00:00:00Z", { value: 7 })] }),
      ],
    });
    expect(payload.series[0]!.points[0]).toEqual({
      t: Date.parse("2024-01-01T00:00:00Z"),
      v: 2,
      o: 1,
      h: 3,
      l: 0.5,
      c: 2,
    });
    expect(payload.series[1]!.points[0]).toEqual({ t: Date.parse("2024-01-02T00:00:00Z"), v: 7 });
  });

  test("drops points with no drawable value", () => {
    const payload = buildChartSharePayload({
      title: "Sparse",
      spec: spec(),
      series: [series({
        points: [
          point("2024-01-01T00:00:00Z", { value: null }),
          point("2024-01-02T00:00:00Z", { value: Number.NaN }),
          point("2024-01-03T00:00:00Z", { value: 5 }),
        ],
      })],
    });
    expect(payload.series[0]!.points).toEqual([{ t: Date.parse("2024-01-03T00:00:00Z"), v: 5 }]);
  });

  test("orders points even when the resolver emitted them out of sequence", () => {
    const payload = buildChartSharePayload({
      title: "Unordered",
      spec: spec(),
      series: [series({
        points: [
          point("2024-01-03T00:00:00Z", { value: 3 }),
          point("2024-01-01T00:00:00Z", { value: 1 }),
        ],
      })],
    });
    expect(payload.series[0]!.points.map((entry) => entry.v)).toEqual([1, 3]);
  });

  test("excludes hidden and empty series, and the panels they were alone on", () => {
    const payload = buildChartSharePayload({
      title: "Partly hidden",
      spec: spec(),
      series: [
        series({ id: "shown", panelId: "price" }),
        series({ id: "hidden", panelId: "volume", hidden: true }),
        series({ id: "empty", panelId: "volume", points: [] }),
      ],
    });
    expect(payload.series.map((entry) => entry.id)).toEqual(["shown"]);
    expect(payload.panels.map((panel) => panel.id)).toEqual(["price"]);
  });

  test("keeps the spec so the terminal can reopen the chart live", () => {
    const source = spec();
    const payload = buildChartSharePayload({ title: "AAPL", spec: source, series: [series()] });
    expect(payload.spec).toEqual(source);
    expect(payload.spec).not.toBe(source);
  });

  test("records the captured window as ISO bounds", () => {
    const payload = buildChartSharePayload({
      title: "AAPL",
      spec: spec(),
      series: [series()],
      window: { start: new Date("2024-01-01T00:00:00Z"), end: new Date("2024-06-01T00:00:00Z") },
    });
    expect(payload.window).toEqual({
      start: "2024-01-01T00:00:00.000Z",
      end: "2024-06-01T00:00:00.000Z",
    });
  });
});
