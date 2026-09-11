import { describe, expect, test } from "bun:test";
import type { CompositeChartScene } from "./types";
import {
  formatChartLegendValue,
  formatCompositeAxisValue,
  formatCompositeCursorDate,
  formatCompositeCursorValue,
  formatCompositePointDetails,
  formatCompositeSeriesValue,
  formatCompositeTimeAxisDate,
  formatOhlcvHud,
} from "./format";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import {
  renderCompositeTimeAxis,
  renderCompositeViewportTimeAxis,
} from "./text-renderer";

function scene(start: string, end: string): CompositeChartScene {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  return {
    width: 80,
    height: 10,
    startTime,
    endTime,
    timeScale: { kind: "calendar", startTime, endTime },
    dates: [],
    dateRatios: [],
    panels: [],
    cursorDate: null,
    cursorXRatio: null,
    cursorValues: [],
  };
}

describe("composite chart timestamp formatting", () => {
  test("shows UTC times on a same-day intraday chart", () => {
    const intraday = scene("2025-01-02T09:30:00Z", "2025-01-02T16:00:00Z");
    const cursor = new Date("2025-01-02T12:05:00Z");

    expect(formatCompositeCursorDate(cursor, intraday.startTime, intraday.endTime))
      .toBe("2025-01-02 12:05 UTC");
    expect(formatCompositeTimeAxisDate(cursor, intraday.startTime, intraday.endTime))
      .toBe("12:05 UTC");
    expect(renderCompositeTimeAxis(intraday, 60)).toContain("09:30 UTC");
    expect(renderCompositeTimeAxis(intraday, 60)).toContain("12:00");
    expect(renderCompositeTimeAxis(intraday, 60)).toContain("16:00 UTC");
  });

  test("adds the date to UTC time ticks when an intraday span crosses days", () => {
    const overnight = scene("2025-01-01T23:30:00Z", "2025-01-02T00:30:00Z");

    expect(formatCompositeTimeAxisDate(
      new Date("2025-01-02T00:15:00Z"),
      overnight.startTime,
      overnight.endTime,
    )).toBe("01-02 00:15 UTC");
    const axis = renderCompositeTimeAxis(overnight, 80);
    expect(axis).toContain("Jan 1 23:30 UTC");
    expect(axis).toContain("Jan 2 00:00");
    expect(axis).toContain("Jan 2 00:30 UTC");
  });

  test("keeps longer chart spans as concise UTC calendar dates", () => {
    const weekly = scene("2025-01-01T09:30:00Z", "2025-01-08T16:00:00Z");
    const cursor = new Date("2025-01-04T12:05:00Z");

    expect(formatCompositeCursorDate(cursor, weekly.startTime, weekly.endTime)).toBe("2025-01-04");
    expect(formatCompositeTimeAxisDate(cursor, weekly.startTime, weekly.endTime)).toBe("2025-01-04");
    expect(renderCompositeTimeAxis(weekly, 60)).toContain("Jan 1");
    expect(renderCompositeTimeAxis(weekly, 60)).toContain("Jan 8");
  });

  test("labels an intraday cursor in the display timezone", () => {
    const intraday = scene("2025-01-02T09:30:00Z", "2025-01-02T16:00:00Z");
    const cursor = new Date("2025-01-02T12:05:00Z");

    expect(formatCompositeCursorDate(cursor, intraday.startTime, intraday.endTime, "America/New_York"))
      .toBe("2025-01-02 07:05 EST");
    expect(formatCompositeTimeAxisDate(cursor, intraday.startTime, intraday.endTime, "America/New_York"))
      .toBe("07:05 EST");
  });

  test("renders recovery-shell dates directly from a viewport", () => {
    const axis = renderCompositeViewportTimeAxis({
      start: new Date("2025-01-01T00:00:00.000Z"),
      end: new Date("2025-01-08T00:00:00.000Z"),
    }, 60);

    expect(axis).toContain("Jan 1");
    expect(axis).toContain("Jan 8");
  });
});

describe("composite chart point details", () => {
  test("disambiguates fiscal period, availability, and provenance", () => {
    const point: TimeSeriesPoint = {
      date: new Date("2025-03-14T00:00:00.000Z"),
      observedAt: new Date("2025-01-26T00:00:00.000Z"),
      availableAt: new Date("2025-03-14T00:00:00.000Z"),
      value: 42,
      periodLabel: "FY2025",
      provenance: {
        providerId: "sec-filings",
        quality: "reported",
      },
    };

    expect(formatCompositePointDetails(point)).toBe(
      "FY2025 · Period ended 2025-01-26 · Available 2025-03-14 · Reported · Source sec-filings",
    );
  });

  test("omits a duplicate availability date for ordinary observations", () => {
    const observedAt = new Date("2025-01-02T00:00:00.000Z");
    expect(formatCompositePointDetails({
      date: observedAt,
      observedAt,
      availableAt: observedAt,
      value: 10,
    })).toBe("Observed 2025-01-02");
  });

  test("retains non-midnight observation and availability times", () => {
    expect(formatCompositePointDetails({
      date: new Date("2025-01-02T12:05:00.000Z"),
      observedAt: new Date("2025-01-02T09:30:00.000Z"),
      availableAt: new Date("2025-01-02T12:05:00.000Z"),
      value: 10,
    })).toBe("Observed 2025-01-02 09:30 UTC · Available 2025-01-02 12:05 UTC");
  });
});

describe("composite chart unit formatting", () => {
  test("keeps derived ratio dimensions visible instead of labeling them as multiples", () => {
    const derived: ResolvedSeries = {
      id: "ratio",
      label: "Price / Revenue",
      color: "#ffffff",
      unit: "1/share",
      unitGroup: "derived-unit:1/share",
      nativeFrequency: "quarterly",
      dataShape: "scalar",
      style: "step",
      transform: "raw",
      axis: "left",
      panelId: "formula",
      interpolation: "step-after",
      points: [],
    };
    expect(formatCompositeSeriesValue(0.000000003, derived)).toBe("3.00e-9 1/share");
    expect(formatCompositeAxisValue(0.5, {
      side: "left",
      min: 0,
      max: 1,
      scale: "linear",
      unit: "USD/JPY",
      unitGroup: "derived-unit:usd/jpy",
      seriesIds: ["ratio"],
    })).toBe("0.500");
  });

  test("shows full price precision in the legend and cursor, not compact axis ticks", () => {
    const btc: ResolvedSeries = {
      id: "btc",
      label: "BTC-USD Price",
      color: "#ffffff",
      unit: "USD",
      unitGroup: "price:USD",
      nativeFrequency: "daily",
      dataShape: "ohlcv",
      style: "candles",
      transform: "raw",
      axis: "left",
      panelId: "main",
      interpolation: "none",
      points: [],
    };
    const domain = {
      side: "left" as const,
      min: 70_000,
      max: 80_000,
      scale: "linear" as const,
      unit: "USD",
      unitGroup: "price:USD",
      seriesIds: ["btc"],
    };

    expect(formatCompositeSeriesValue(79_432.18, btc)).toBe("$79,432.18");
    expect(formatChartLegendValue(79_432.18, "USD", "price:USD")).toBe("$79,432.18");
    expect(formatCompositeCursorValue(79_432.18, domain)).toBe("$79,432.18");
    expect(formatCompositeAxisValue(79_432.18, domain)).toBe("$79K");
  });
});

describe("formatOhlcvHud", () => {
  test("formats full OHLCV with compact volume", () => {
    const hud = formatOhlcvHud({
      value: 326.37,
      open: 326.10,
      high: 328.40,
      low: 325.20,
      close: 326.37,
      volume: 4_820_000,
    }, "USD", "price:USD");
    const o = formatChartLegendValue(326.10, "USD", "price:USD");
    const h = formatChartLegendValue(328.40, "USD", "price:USD");
    const l = formatChartLegendValue(325.20, "USD", "price:USD");
    const c = formatChartLegendValue(326.37, "USD", "price:USD");

    expect(hud).toBe(`O ${o}  H ${h}  L ${l}  C ${c}  V 4.8M`);
    expect(hud).toContain("O ");
    expect(hud).toContain("H ");
    expect(hud).toContain("L ");
    expect(hud).toContain("C ");
    expect(hud).toContain("V ");
  });

  test("returns null for close-only points", () => {
    expect(formatOhlcvHud({
      value: 326.37,
      close: 326.37,
    }, "USD", "price:USD")).toBeNull();
  });

  test("omits open for HLC bars", () => {
    const hud = formatOhlcvHud({
      value: 326.37,
      high: 328.40,
      low: 325.20,
      close: 326.37,
    }, "USD", "price:USD");

    expect(hud).not.toMatch(/\bO /);
    expect(hud).toContain("H ");
    expect(hud).toContain("L ");
    expect(hud).toContain("C ");
    expect(hud).toBe(
      `H ${formatChartLegendValue(328.40, "USD", "price:USD")}  L ${formatChartLegendValue(325.20, "USD", "price:USD")}  C ${formatChartLegendValue(326.37, "USD", "price:USD")}`,
    );
  });

  test("prints zero volume as V 0", () => {
    const hud = formatOhlcvHud({
      value: 10,
      open: 10,
      high: 11,
      low: 9,
      close: 10,
      volume: 0,
    }, "USD", "price:USD");
    expect(hud).toContain("V 0");
    expect(hud!.endsWith("  V 0")).toBe(true);
  });
});
