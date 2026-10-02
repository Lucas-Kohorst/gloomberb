import { describe, expect, test } from "bun:test";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import {
  buildPriceStrip,
  fitPriceStrip,
  priceStripSegments,
  priceStripText,
  priceStripWidth,
  PRICE_STRIP_RANK,
} from "./price-strip";

function point(date: string, value: number, extra: Partial<TimeSeriesPoint> = {}): TimeSeriesPoint {
  const observedAt = new Date(`${date}T00:00:00.000Z`);
  return { date: observedAt, observedAt, value, ...extra };
}

function priceSeries(overrides: Partial<ResolvedSeries> = {}): ResolvedSeries {
  return {
    id: "price",
    label: "ACME",
    color: "#00ff66",
    unit: "USD",
    unitGroup: "currency",
    nativeFrequency: "daily",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    points: [point("2025-01-01", 100), point("2025-01-02", 110), point("2025-01-03", 105)],
    ...overrides,
  };
}

function render(series: ResolvedSeries, budget = 200): string {
  return priceStripText(fitPriceStrip(buildPriceStrip({ series }), budget));
}

describe("buildPriceStrip", () => {
  test("reads the last print, the move off the first visible point, and the window extremes", () => {
    expect(render(priceSeries())).toBe("ACME $105  +$5  +5.00%  H $110  L $100");
  });

  test("prefers the quote's own move over the window baseline", () => {
    const series = priceSeries({
      latestChange: -1.25,
      latestChangePercent: -2.5,
      previousClose: 51,
    });

    const text = render(series);

    expect(text).toBe("ACME $105  -$1.25  -2.50%  H $110  L $100");
  });

  test("prints the hovered bar's OHLC instead of the window extremes", () => {
    const series = priceSeries({
      dataShape: "ohlcv",
      points: [
        point("2025-01-01", 104, { open: 100, high: 110, low: 95, close: 104 }),
        point("2025-01-02", 108, { open: 104, high: 112, low: 101, close: 108 }),
      ],
    });

    expect(render(series)).toBe("ACME O $104  H $112  L $101  C $108  +$4  +3.85%");
  });

  test("swaps the print to the crosshair bar while the move stays on the window", () => {
    const strip = buildPriceStrip({
      series: priceSeries(),
      cursorPoint: point("2025-01-02", 110),
      cursorValue: 110,
    });

    expect(priceStripText(fitPriceStrip(strip, 200))).toBe(
      "ACME $110  +$10  +10.00%  H $110  L $100",
    );
  });
});

describe("fitPriceStrip", () => {
  test("drops the window extremes before it touches the core numbers", () => {
    const strip = buildPriceStrip({ series: priceSeries() });
    const coreOnly = priceStripWidth(
      strip.label,
      strip.tokens.filter((token) => token.rank === PRICE_STRIP_RANK.core),
    );

    expect(priceStripText(fitPriceStrip(strip, coreOnly))).toBe(
      "ACME $105  +$5  +5.00%",
    );
  });

  test("ellipsizes the name once the core numbers need the room", () => {
    const strip = buildPriceStrip({
      series: priceSeries({ label: "A very long index name" }),
    });

    expect(priceStripText(fitPriceStrip(strip, 30))).toBe(
      "A very lo... $105  +$5  +5.00%",
    );
  });

  test("keeps segments separated and carries the direction of each move", () => {
    const layout = fitPriceStrip(buildPriceStrip({ series: priceSeries() }), 200);

    expect(priceStripSegments(layout)).toEqual([
      { text: "ACME", kind: "label" },
      { text: " $105", kind: "token" },
      { text: "  +$5", kind: "token", direction: "up" },
      { text: "  +5.00%", kind: "token", direction: "up" },
      { text: "  H $110", kind: "token" },
      { text: "  L $100", kind: "token" },
    ]);
  });
});
