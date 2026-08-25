import { describe, expect, test } from "bun:test";
import type { ChartSharePayload, ChartShareSeries } from "../../shares/payload";
import {
  formatShareChange,
  formatShareCursorDate,
  formatShareRange,
  formatShareSpan,
  formatShareTickMark,
  SHARE_TICK,
  nearestSharePoint,
  payloadTimeSpan,
  seriesShareStats,
  shareLegendName,
  shareTimeVisible,
} from "./chart-stats";

function series(overrides: Partial<ChartShareSeries> = {}): ChartShareSeries {
  return {
    id: "s1",
    label: "Clarity Act (H.R.3633) signed into law in 2026?",
    color: "#6aa3e6",
    style: "line",
    axis: "right",
    panelId: "price",
    unit: "%",
    points: [
      { t: Date.parse("2026-02-02T00:00:00Z"), v: 60 },
      { t: Date.parse("2026-03-12T00:00:00Z"), v: 79.2 },
      { t: Date.parse("2026-08-25T00:00:00Z"), v: 14.5 },
    ],
    ...overrides,
  };
}

describe("seriesShareStats", () => {
  test("reads first, last, and high/low from the frozen points", () => {
    const stats = seriesShareStats(series());
    expect(stats).toEqual({
      first: 60,
      last: 14.5,
      high: 79.2,
      low: 14.5,
      firstMs: Date.parse("2026-02-02T00:00:00Z"),
      lastMs: Date.parse("2026-08-25T00:00:00Z"),
      pointCount: 3,
    });
  });

  test("skips points with no drawable value", () => {
    const stats = seriesShareStats(series({
      points: [
        { t: 1, v: null },
        { t: 2, v: 4 },
        { t: 3 },
        { t: 4, v: 9 },
      ],
    }));
    expect(stats?.first).toBe(4);
    expect(stats?.last).toBe(9);
    expect(stats?.pointCount).toBe(2);
  });
});

describe("share legend copy", () => {
  test("omits the series name when the pane header already has it", () => {
    const title = "Clarity Act (H.R.3633) signed into law in 2026?";
    expect(shareLegendName(title, title)).toBeNull();
    expect(shareLegendName("AAPL", title)).toBe("AAPL");
  });

  test("reports probability moves in percentage points, not a relative percent", () => {
    expect(formatShareChange(seriesShareStats(series())!, "%")).toBe("-45.5pp");
  });

  test("reports priced moves as absolute and relative change", () => {
    const stats = seriesShareStats(series({
      unit: "USD",
      points: [
        { t: 1, v: 100 },
        { t: 2, v: 112 },
      ],
    }))!;
    expect(formatShareChange(stats, "USD")).toBe("+12 (+12%)");
  });

  test("formats the plotted high/low once, without repeating the title", () => {
    const stats = seriesShareStats(series())!;
    expect(formatShareRange(stats, (value) => `${value}`)).toBe("14.5–79.2");
  });
});

describe("share time labels", () => {
  test("uses a readable window instead of mixed day numbers", () => {
    expect(formatShareSpan(
      Date.parse("2026-02-02T00:00:00Z"),
      Date.parse("2026-08-25T00:00:00Z"),
    )).toBe("Feb 2 – Aug 25, 2026");
  });

  test("keeps UTC clocks on an intraday span", () => {
    expect(formatShareSpan(
      Date.parse("2026-08-25T13:30:00Z"),
      Date.parse("2026-08-25T20:00:00Z"),
    )).toBe("Aug 25, 2026 13:30–20:00 UTC");
    expect(shareTimeVisible(
      Date.parse("2026-08-25T13:30:00Z"),
      Date.parse("2026-08-25T20:00:00Z"),
    )).toBe(true);
  });

  test("day-of-month ticks include the month so a bare 16 is not ambiguous", () => {
    expect(formatShareTickMark(Date.parse("2026-08-16T00:00:00Z"), SHARE_TICK.dayOfMonth)).toBe("16 Aug");
    expect(formatShareTickMark(Date.parse("2026-03-01T00:00:00Z"), SHARE_TICK.month)).toBe("Mar");
  });

  test("cursor date follows the same span convention as the window", () => {
    expect(formatShareCursorDate(
      Date.parse("2026-03-12T00:00:00Z"),
      Date.parse("2026-02-02T00:00:00Z"),
      Date.parse("2026-08-25T00:00:00Z"),
    )).toBe("Mar 12, 2026");
  });
});

describe("payload helpers", () => {
  test("span covers every plotted series", () => {
    const payload = {
      title: "Two",
      capturedAt: "2026-08-25T00:00:00Z",
      panels: [{ id: "price" }],
      series: [
        series({ id: "a", points: [{ t: Date.parse("2026-01-01T00:00:00Z"), v: 1 }] }),
        series({ id: "b", points: [{ t: Date.parse("2026-06-01T00:00:00Z"), v: 2 }] }),
      ],
    } satisfies ChartSharePayload;
    expect(payloadTimeSpan(payload)).toEqual({
      startMs: Date.parse("2026-01-01T00:00:00Z"),
      endMs: Date.parse("2026-06-01T00:00:00Z"),
    });
  });

  test("nearest point is the hovered observation, not the last print", () => {
    const point = nearestSharePoint(series(), Date.parse("2026-03-12T06:00:00Z"));
    expect(point?.v).toBe(79.2);
  });
});
