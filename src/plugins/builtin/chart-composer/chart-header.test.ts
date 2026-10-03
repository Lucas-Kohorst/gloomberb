import { expect, test } from "bun:test";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import { selectChartHeader } from "./chart-header";

function point(day: number, value: number, ohlc?: { open: number; high: number; low: number }): TimeSeriesPoint {
  return {
    date: new Date(Date.UTC(2024, 0, day)),
    observedAt: new Date(Date.UTC(2024, 0, day)),
    value,
    close: value,
    ...ohlc,
  };
}

function series(overrides: Partial<ResolvedSeries> & Pick<ResolvedSeries, "id" | "points">): ResolvedSeries {
  return {
    label: overrides.id,
    color: "#fff",
    unit: "USD",
    unitGroup: "price:USD",
    nativeFrequency: "daily",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "right",
    panelId: "main",
    interpolation: "none",
    ...overrides,
  };
}

const price = series({
  id: "px",
  label: "AAPL",
  dataShape: "ohlcv",
  style: "candles",
  points: [
    point(1, 10, { open: 9, high: 11, low: 8 }),
    point(3, 12, { open: 11, high: 13, low: 10 }),
    point(2, 99, { open: 1, high: 2, low: 0 }),
  ],
});

test("the header takes the newest bar's OHLC and the latest value of each study", () => {
  const vwap = series({
    id: "vwap",
    label: "VWAP AAPL",
    points: [point(1, 10), point(3, 11.5), point(2, 4)],
  });
  const sma = series({
    id: "sma",
    label: "SMA(20) AAPL",
    points: [point(3, 12.25)],
  });
  const hidden = series({
    id: "rsi",
    label: "RSI(14) AAPL",
    hidden: true,
    points: [point(3, 70)],
  });
  const header = selectChartHeader({
    series: [price, vwap, sma, hidden],
    baseSeriesIds: new Set(["px"]),
  });

  expect(header.priceSeriesId).toBe("px");
  expect(header.open).toBe(11);
  expect(header.high).toBe(13);
  expect(header.low).toBe(10);
  expect(header.close).toBe(12);
  expect(header.studies).toEqual([
    { id: "vwap", label: "VWAP AAPL", value: 11.5 },
    { id: "sma", label: "SMA(20) AAPL", value: 12.25 },
  ]);
  expect(header.text).toContain("VWAP AAPL");
  expect(header.text).toContain("SMA(20) AAPL");
  expect(header.text).not.toContain("RSI");
  expect(header.levels).toEqual([]);
});

test("a live quote newer than the loaded bar replaces the close and is what an alert would use", () => {
  const stale = series({
    id: "px",
    dataShape: "ohlcv",
    previousClose: 100,
    latestChange: 2.5,
    points: [point(1, 40, { open: 39, high: 41, low: 38 })],
  });
  const header = selectChartHeader({
    series: [stale],
    baseSeriesIds: new Set(["px"]),
  });
  expect(header.close).toBe(102.5);
  expect(header.open).toBeNull();
  expect(header.high).toBeNull();
  expect(header.low).toBeNull();
  expect(header.text.startsWith("C ")).toBe(true);
});

test("the embed header keeps studies and levels and leaves OHLC to TradingView", () => {
  const vwap = series({
    id: "vwap",
    label: "VWAP AAPL",
    points: [point(3, 11.5)],
  });
  const header = selectChartHeader({
    series: [price, vwap],
    baseSeriesIds: new Set(["px"]),
    levels: [{ id: "a", price: 14 }],
    includeLevels: true,
    includeOhlc: false,
  });
  expect(header.close).toBe(12);
  expect(header.text).toContain("VWAP AAPL");
  expect(header.text).toContain("Lvl");
  expect(header.text).not.toMatch(/(?:^|\s)[OHLCV] /);
});

test("the desktop header leaves the volume study to the charting library", () => {
  const volume = series({
    id: "vol",
    label: "Volume HOOD:XNAS Price",
    unit: "shares",
    unitGroup: "volume",
    points: [point(3, 82_000_000)],
  });
  const header = selectChartHeader({
    series: [price, volume],
    baseSeriesIds: new Set(["px"]),
    includeOhlc: false,
    includeVolume: false,
  });
  expect(header.studies).toEqual([]);
  expect(header.text).toBe("");
});

test("levels are listed only on the surface that cannot draw them", () => {
  const input = {
    series: [price],
    baseSeriesIds: new Set(["px"]),
    levels: [
      { id: "b", price: 11 },
      { id: "a", price: 14 },
    ],
  };
  expect(selectChartHeader(input).text).not.toContain("Lvl");
  const listed = selectChartHeader({ ...input, includeLevels: true });
  expect(listed.levels.map((level) => level.price)).toEqual([11, 14]);
  expect(listed.text).toContain("Lvl");
});
