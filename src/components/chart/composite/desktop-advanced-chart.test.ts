import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, useRef, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { UiHostProvider, type UiHost } from "../../../ui";
import type { RendererHost } from "../../../ui/host";

// bun shares one module registry across test files, so restore the real feed.
const realChartingLibraryFeed = await import("../../../plugins/builtin/chart-composer/charting-library-feed");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const setSeriesCalls: unknown[] = [];
const widgetMounts: string[] = [];
let widgetProps: { interval?: string; timezone?: string; symbol?: string } = {};

mock.module("../../../plugins/builtin/chart-composer/charting-library-feed", () => ({
  createResolvedSeriesLibraryFeed() {
    return {
      feed: {},
      setSeries(next: unknown) {
        setSeriesCalls.push(next);
      },
      model() {
        return { symbol: "SPY", compares: [], chartStyle: "line", priceScale: "normal" };
      },
    };
  },
}));

afterAll(() => {
  mock.module("../../../plugins/builtin/chart-composer/charting-library-feed", () => realChartingLibraryFeed);
});

const {
  DesktopAdvancedChart,
  desktopAdvancedChartInterval,
  desktopAdvancedChartTimezone,
  desktopAdvancedSeriesIdentity,
  shouldUseDesktopAdvancedChart,
} = await import("./desktop-advanced-chart");

const testWindow = new Window({ url: "http://localhost/" });
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  testWindow.document.body.innerHTML = "";
  setSeriesCalls.length = 0;
  widgetMounts.length = 0;
  widgetProps = {};
});

function HostBox({ children }: { children?: ReactNode }) {
  return createElement("div", null, children);
}

function HostTradingViewChart(props: { interval?: string; timezone?: string; symbol?: string }) {
  const mounted = useRef(false);
  if (!mounted.current) {
    mounted.current = true;
    widgetMounts.push(`${props.symbol ?? ""}|${props.interval ?? ""}`);
  }
  widgetProps = { interval: props.interval, timezone: props.timezone, symbol: props.symbol };
  return createElement("div");
}

const testUiHost = {
  kind: "desktop-web",
  Box: HostBox,
  TradingViewChart: HostTradingViewChart,
} as unknown as UiHost;

function spaced(gap: number, count = 4): number[] {
  const origin = Date.UTC(2024, 0, 1);
  return Array.from({ length: count }, (_, index) => origin + index * gap);
}

function seriesAt(
  id: string,
  times: readonly number[],
  close = 10,
  timeZone?: string,
) {
  return {
    id,
    label: id,
    style: "line" as const,
    ...(timeZone ? { timeBasis: { timeZone } } : {}),
    points: times.map((time) => ({
      date: new Date(time),
      observedAt: new Date(time),
      value: close,
      close,
    })),
  };
}

function lastTickKey(series: { id: string; points: ReadonlyArray<{ date: Date; close?: number | null; value?: number | null }> }): string {
  const last = series.points.at(-1);
  if (!last) return series.id;
  return `${series.id}:${last.date.getTime()}:${last.close ?? ""}:${last.value ?? ""}`;
}

function chartElement(props: {
  series: ReturnType<typeof seriesAt>[];
  tickKey: string;
  timeZone?: string;
}) {
  return createElement(UiHostProvider, {
    ui: testUiHost,
    renderer: {} as RendererHost,
    nativeRenderer: undefined,
  }, createElement(DesktopAdvancedChart, {
    series: props.series,
    width: 80,
    height: 24,
    background: "#111111",
    tickKey: props.tickKey,
    timeZone: props.timeZone,
  }));
}

async function renderChart(props: {
  series: ReturnType<typeof seriesAt>[];
  tickKey: string;
  timeZone?: string;
}) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root!.render(chartElement(props));
  });
}

describe("shouldUseDesktopAdvancedChart", () => {
  test("keeps real desktop time series on the widget", () => {
    expect(shouldUseDesktopAdvancedChart({
      isDesktopWeb: true,
      hasPoints: true,
      showTimeAxis: true,
    })).toBe(true);
    expect(shouldUseDesktopAdvancedChart({
      isDesktopWeb: true,
      hasPoints: true,
    })).toBe(true);
  });

  test("stays on the canvas for scatter, category, and custom-axis panes", () => {
    expect(shouldUseDesktopAdvancedChart({
      isDesktopWeb: true,
      hasPoints: true,
      xAxis: { labels: ["Jan"] },
    })).toBe(false);
    expect(shouldUseDesktopAdvancedChart({
      isDesktopWeb: true,
      hasPoints: true,
      showTimeAxis: false,
    })).toBe(false);
    expect(shouldUseDesktopAdvancedChart({
      isDesktopWeb: true,
      hasPoints: true,
      formatAxisValue: () => "x",
    })).toBe(false);
    expect(shouldUseDesktopAdvancedChart({
      isDesktopWeb: false,
      hasPoints: true,
    })).toBe(false);
    expect(shouldUseDesktopAdvancedChart({
      isDesktopWeb: true,
      hasPoints: false,
    })).toBe(false);
  });

  test("GLOOM_CHART_BACKEND=custom forces the canvas even on desktop", () => {
    process.env.GLOOM_CHART_BACKEND = "custom";
    try {
      expect(shouldUseDesktopAdvancedChart({
        isDesktopWeb: true,
        hasPoints: true,
        showTimeAxis: true,
      })).toBe(false);
    } finally {
      delete process.env.GLOOM_CHART_BACKEND;
    }
    expect(shouldUseDesktopAdvancedChart({
      isDesktopWeb: true,
      hasPoints: true,
      showTimeAxis: true,
    })).toBe(true);
  });
});

describe("desktopAdvancedChartInterval", () => {
  test("maps the median gap onto a TradingView interval", () => {
    expect(desktopAdvancedChartInterval(spaced(MINUTE))).toBe("1");
    expect(desktopAdvancedChartInterval(spaced(15 * MINUTE))).toBe("15");
    expect(desktopAdvancedChartInterval(spaced(HOUR))).toBe("60");
    expect(desktopAdvancedChartInterval(spaced(4 * HOUR))).toBe("240");
    expect(desktopAdvancedChartInterval(spaced(DAY))).toBe("D");
    expect(desktopAdvancedChartInterval(spaced(7 * DAY))).toBe("W");
    expect(desktopAdvancedChartInterval(spaced(30 * DAY))).toBe("M");
  });

  test("takes the first matching max gap and defaults when there is no gap", () => {
    expect(desktopAdvancedChartInterval(spaced(90_000))).toBe("1");
    expect(desktopAdvancedChartInterval(spaced(90_001))).toBe("5");
    expect(desktopAdvancedChartInterval(spaced(360_000))).toBe("5");
    expect(desktopAdvancedChartInterval(spaced(1_200_000))).toBe("15");
    expect(desktopAdvancedChartInterval(spaced(2_400_000))).toBe("30");
    expect(desktopAdvancedChartInterval(spaced(3_000_000))).toBe("45");
    expect(desktopAdvancedChartInterval(spaced(5_400_000))).toBe("60");
    expect(desktopAdvancedChartInterval(spaced(18_000_000))).toBe("240");
    expect(desktopAdvancedChartInterval(spaced(172_800_000))).toBe("D");
    expect(desktopAdvancedChartInterval(spaced(172_800_001))).toBe("W");
    expect(desktopAdvancedChartInterval(spaced(1_209_600_000))).toBe("W");
    expect(desktopAdvancedChartInterval(spaced(1_209_600_001))).toBe("M");
    expect(desktopAdvancedChartInterval([])).toBe("D");
    expect(desktopAdvancedChartInterval([Date.UTC(2024, 0, 1)])).toBe("D");
    expect(desktopAdvancedChartInterval([Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 1)])).toBe("D");
    expect(desktopAdvancedChartInterval([...spaced(15 * MINUTE)].reverse())).toBe("15");
  });

  test("keeps daily bars daily when a weekend gap is the outlier", () => {
    const monday = Date.UTC(2024, 0, 1);
    const times = [
      monday,
      monday + DAY,
      monday + 2 * DAY,
      monday + 3 * DAY,
      monday + 4 * DAY,
      monday + 7 * DAY,
      monday + 8 * DAY,
    ];
    expect(desktopAdvancedChartInterval(times)).toBe("D");
  });
});

describe("desktop advanced chart timezone and series identity", () => {
  test("prefers the chart zone, then the primary series zone, then Etc/UTC", () => {
    expect(desktopAdvancedChartTimezone("America/New_York", "Europe/London")).toBe("America/New_York");
    expect(desktopAdvancedChartTimezone(undefined, "Europe/London")).toBe("Europe/London");
    expect(desktopAdvancedChartTimezone("  ", "Europe/London")).toBe("Europe/London");
    expect(desktopAdvancedChartTimezone(undefined, undefined)).toBe("Etc/UTC");
    expect(desktopAdvancedChartTimezone("", "  ")).toBe("Etc/UTC");
  });

  test("changes when history is replaced and ignores a last-print close change", () => {
    const last = Date.UTC(2024, 5, 3);
    const original = seriesAt("px", [last - 3 * DAY, last - 2 * DAY, last - DAY, last], 10);
    const replaced = seriesAt("px", [last - 6 * DAY, last - 5 * DAY, last - 4 * DAY, last - 3 * DAY, last - 2 * DAY, last - DAY, last], 10);
    const repriced = {
      ...original,
      points: original.points.map((point, index) => (
        index === original.points.length - 1 ? { ...point, close: 12, value: 12 } : point
      )),
    };
    expect(original.points.at(-1)?.date.getTime()).toBe(replaced.points.at(-1)?.date.getTime());
    expect(desktopAdvancedSeriesIdentity([original])).not.toBe(desktopAdvancedSeriesIdentity([replaced]));
    expect(desktopAdvancedSeriesIdentity([original])).toBe(desktopAdvancedSeriesIdentity([repriced]));
    const compare = seriesAt("qqq", [last - DAY, last], 20);
    const compareReplaced = seriesAt("qqq", [last - 2 * DAY, last - DAY, last], 20);
    expect(desktopAdvancedSeriesIdentity([original, compare])).not.toBe(
      desktopAdvancedSeriesIdentity([original, compareReplaced]),
    );
  });
});

describe("DesktopAdvancedChart", () => {
  test("defaults actual intraday OHLC to four hours without promoting daily snapshots", async () => {
    const source = seriesAt("px", spaced(HOUR, 6), 10);
    const ohlc = { ...source, points: source.points.map((point) => ({ ...point, open: 9, high: 11, low: 8, close: 10 })) };
    await renderChart({ series: [ohlc], tickKey: lastTickKey(ohlc) });
    expect(widgetProps.interval).toBe("240");
    const daily = { ...ohlc, points: ohlc.points.map((point, index) => ({ ...point, date: new Date(Date.UTC(2024, 0, index + 1)) })) };
    await act(async () => { root!.render(chartElement({ series: [daily], tickKey: lastTickKey(daily) })); });
    expect(widgetProps.interval).toBe("D");
  });

  test("passes cadence and timezone and refreshes history that keeps the last print", async () => {
    const last = Date.UTC(2024, 3, 10);
    const original = seriesAt("px", [last - 3 * DAY, last - 2 * DAY, last - DAY, last], 10, "Europe/London");
    await renderChart({
      series: [original],
      tickKey: lastTickKey(original),
      timeZone: "America/Chicago",
    });
    expect(setSeriesCalls).toHaveLength(1);
    expect(widgetProps).toEqual({ interval: "D", timezone: "America/Chicago", symbol: "SPY" });
    expect(widgetMounts).toEqual(["SPY|D"]);

    const samePrint = seriesAt("px", original.points.map((point) => point.date.getTime()), 10, "Europe/London");
    await act(async () => {
      root!.render(chartElement({
        series: [samePrint],
        tickKey: lastTickKey(samePrint),
        timeZone: "America/Chicago",
      }));
    });
    expect(setSeriesCalls).toHaveLength(1);
    expect(widgetMounts).toEqual(["SPY|D"]);

    const replaced = seriesAt(
      "px",
      [last - 8 * DAY, last - 7 * DAY, last - 6 * DAY, last - 5 * DAY, last - 4 * DAY, last - 3 * DAY, last - 2 * DAY, last - DAY, last],
      10,
      "Europe/London",
    );
    expect(lastTickKey(replaced)).toBe(lastTickKey(original));
    await act(async () => {
      root!.render(chartElement({
        series: [replaced],
        tickKey: lastTickKey(replaced),
        timeZone: "America/Chicago",
      }));
    });
    expect(setSeriesCalls).toHaveLength(2);
    const pushed = setSeriesCalls[1] as Array<{ points: Array<{ date: Date }> }>;
    expect(pushed[0]?.points.length).toBe(replaced.points.length);
    expect(pushed[0]?.points[0]?.date.getTime()).toBe(replaced.points[0]?.date.getTime());
    expect(widgetMounts).toEqual(["SPY|D"]);

    const repricedPoints = replaced.points.map((point, index) => (
      index === replaced.points.length - 1 ? { ...point, close: 14, value: 14 } : point
    ));
    const repriced = { ...replaced, points: repricedPoints };
    await act(async () => {
      root!.render(chartElement({
        series: [repriced],
        tickKey: lastTickKey(repriced),
        timeZone: "America/Chicago",
      }));
    });
    expect(setSeriesCalls).toHaveLength(3);
    expect(lastTickKey(repriced)).not.toBe(lastTickKey(replaced));
    expect(widgetMounts).toEqual(["SPY|D"]);
    const closePushed = setSeriesCalls[2] as Array<{ points: Array<{ close?: number }> }>;
    expect(closePushed[0]?.points.at(-1)?.close).toBe(14);

    const intraday = seriesAt("px", spaced(MINUTE, 6), 11, "Europe/London");
    await act(async () => {
      root!.render(chartElement({
        series: [intraday],
        tickKey: lastTickKey(intraday),
        timeZone: "America/Chicago",
      }));
    });
    expect(widgetProps.interval).toBe("1");
    expect(widgetMounts.at(-1)).toBe("SPY|1");
    expect(setSeriesCalls.length).toBeGreaterThanOrEqual(4);
  });

  test("uses the series zone, then Etc/UTC, when the chart zone is absent", async () => {
    const last = Date.UTC(2024, 3, 10);
    const zoned = seriesAt("px", [last - DAY, last], 10, "America/Chicago");
    await renderChart({ series: [zoned], tickKey: lastTickKey(zoned) });
    expect(widgetProps.timezone).toBe("America/Chicago");
    expect(widgetProps.interval).toBe("D");

    const unzoned = seriesAt("px", [last - 15 * MINUTE, last], 10);
    await act(async () => {
      root!.render(chartElement({
        series: [unzoned],
        tickKey: lastTickKey(unzoned),
      }));
    });
    expect(widgetProps.timezone).toBe("Etc/UTC");
    expect(widgetProps.interval).toBe("15");
  });
});
