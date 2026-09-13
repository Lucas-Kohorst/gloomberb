import { describe, expect, test } from "bun:test";
import type { ResolvedSeries } from "../time-series/types";
import { MAX_SHARE_BYTES, parseSharePayload } from "./payload";
import { buildChartShareData } from "./chart-snapshot";

function series(pointCount: number): ResolvedSeries {
  return {
    id: "price",
    label: "AAPL",
    color: "#fff",
    unit: "USD",
    unitGroup: "currency:USD",
    nativeFrequency: "daily",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    points: Array.from({ length: pointCount }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, index + 1)),
      observedAt: new Date(Date.UTC(2025, 0, index + 1)),
      value: index,
    })),
  };
}

describe("chart share snapshots", () => {
  test("keeps endpoints while bounding shared chart points", () => {
    const shared = buildChartShareData([series(1_000)]);
    expect(shared?.series[0]?.points).toHaveLength(500);
    expect(shared?.series[0]?.points[0]?.y).toBe(0);
    expect(shared?.series[0]?.points.at(-1)?.y).toBe(999);
  });

  test("keeps series style, color, and OHLC so the public chart is not a green polyline", () => {
    const candles: ResolvedSeries = {
      ...series(3),
      color: "#e0a458",
      style: "candles",
      panelId: "price",
      points: [{
        date: new Date(Date.UTC(2025, 0, 2)),
        observedAt: new Date(Date.UTC(2025, 0, 2)),
        value: 10,
        open: 8,
        high: 12,
        low: 7,
        close: 10,
      }],
    };
    const shared = buildChartShareData([candles], {
      spec: {
        version: 2,
        viewport: { range: "1Y", resolution: "1d" },
        panels: [{ id: "price", label: "Price" }],
        series: [],
        studies: [],
      },
    });
    expect(shared).toMatchObject({
      series: [{
        name: "AAPL",
        color: "#e0a458",
        style: "candles",
        panelId: "price",
        points: [{ y: 10, o: 8, h: 12, l: 7, c: 10 }],
      }],
      panels: [{ id: "price", label: "Price" }],
    });
  });
})

 test("samples rich multi-series candles to the total envelope byte budget", () => {
  const entries = Array.from({ length: 4 }, () => ({
    ...series(500),
    style: "candles" as const,
    points: series(500).points.map((point) => ({ ...point, value: 123.456789012345, open: 122.456789012345, high: 124.456789012345, low: 121.456789012345, close: 123.456789012345 })),
  }));
  const shared = buildChartShareData(entries);
  expect(shared).not.toBeNull();
  expect(parseSharePayload({ kind: "chart", data: shared })).not.toBeNull();
  expect(new TextEncoder().encode(JSON.stringify({ kind: "chart", data: shared })).byteLength).toBeLessThanOrEqual(MAX_SHARE_BYTES);
  for (const entry of shared!.series) {
    expect(entry.points[0]!.x).toBe(entries[0]!.points[0]!.date.toISOString());
    expect(entry.points.at(-1)!.x).toBe(entries[0]!.points.at(-1)!.date.toISOString());
  }
});

test("returns null when metadata cannot fit even after sampling", () => {
  expect(buildChartShareData([series(500)], { title: "x".repeat(MAX_SHARE_BYTES) })).toBeNull();
});
