import { describe, expect, test } from "bun:test";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../../time-series/types";
import {
  orderedPointsBySecond,
  tradingViewCandleData,
  tradingViewScalarData,
  tradingViewSeriesTypeFor,
} from "./tradingview-series-data";

function point(iso: string, overrides: Partial<TimeSeriesPoint> = {}): TimeSeriesPoint {
  const date = new Date(iso);
  return { date, observedAt: date, value: 1, ...overrides };
}

function series(overrides: Partial<ResolvedSeries> & Pick<ResolvedSeries, "points" | "style">): ResolvedSeries {
  return {
    id: "s",
    label: "S",
    color: "#0f0",
    unit: "USD",
    unitGroup: "currency",
    nativeFrequency: "1m",
    dataShape: "scalar",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    ...overrides,
  };
}

describe("tradingview series data", () => {
  test("collapses duplicate UTC seconds to the latest reading", () => {
    const earlier = point("2024-01-01T12:00:00.100Z", { value: 10 });
    const later = point("2024-01-01T12:00:00.900Z", { value: 20 });
    const ordered = orderedPointsBySecond([earlier, later]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]![1].value).toBe(20);
  });

  test("orders by second even when input is reversed", () => {
    const a = point("2024-01-01T12:00:02.000Z", { value: 2 });
    const b = point("2024-01-01T12:00:01.000Z", { value: 1 });
    expect(tradingViewScalarData([a, b]).map((entry) => entry.value)).toEqual([1, 2]);
  });

  test("scalar path falls back to close when value is missing", () => {
    const onlyClose = point("2024-01-01T12:00:00.000Z", { value: undefined, close: 42 });
    expect(tradingViewScalarData([onlyClose])).toEqual([{ time: 1_704_110_400, value: 42 }]);
  });

  test("candle path keeps OHLC bars and drops incomplete ones", () => {
    const full = point("2024-01-01T12:00:00.000Z", {
      open: 1, high: 3, low: 0.5, close: 2, value: 2,
    });
    const incomplete = point("2024-01-01T12:01:00.000Z", { value: 9 });
    expect(tradingViewCandleData([full, incomplete])).toEqual([{
      time: 1_704_110_400,
      open: 1,
      high: 3,
      low: 0.5,
      close: 2,
    }]);
  });

  test("maps styles to lightweight-charts series types", () => {
    expect(tradingViewSeriesTypeFor(series({ style: "columns", points: [] }))).toBe("Histogram");
    expect(tradingViewSeriesTypeFor(series({ style: "area", points: [] }))).toBe("Area");
    expect(tradingViewSeriesTypeFor(series({
      style: "candles",
      points: [point("2024-01-01T12:00:00.000Z", { open: 1, high: 2, low: 0.5, close: 1.5 })],
    }))).toBe("Candlestick");
    expect(tradingViewSeriesTypeFor(series({
      style: "ohlc",
      points: [point("2024-01-01T12:00:00.000Z", { open: 1, high: 2, low: 0.5, close: 1.5 })],
    }))).toBe("Bar");
  });
});
