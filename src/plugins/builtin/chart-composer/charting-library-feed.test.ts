import { describe, expect, test } from "bun:test";
import type { TimeSeriesPoint } from "../../../time-series/types";
import {
  barFromPoint,
  createResolvedSeriesLibraryFeed,
  librarySafeTicker,
  resolutionFromLibraryInterval,
  selectLibraryBars,
} from "./charting-library-feed";

function point(day: number, close: number, open?: number): TimeSeriesPoint {
  const date = new Date(Date.UTC(2024, 0, day));
  return { date, observedAt: date, value: close, close, open: open ?? close, high: close, low: open ?? close };
}

function weekPoints(): TimeSeriesPoint[] {
  const stamp = (
    iso: string,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
  ): TimeSeriesPoint => {
    const date = new Date(iso);
    return { date, observedAt: date, value: close, open, high, low, close, volume };
  };
  return [
    stamp("2026-09-15T04:00:00.000Z", 9, 11, 8, 10, 1),
    stamp("2026-09-16T04:00:00.000Z", 10, 14, 9, 12, 2),
    stamp("2026-09-24T04:00:00.000Z", 20, 21, 19, 20, 5),
    stamp("2026-10-02T20:00:00.000Z", 90, 99, 88, 99, 7),
  ];
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function readBars(
  feed: {
    getBars: (
      symbolInfo: { ticker?: string },
      resolution: string,
      periodParams: { from: number; to: number; countBack: number },
      onResult: (bars: Array<{ time: number; close: number }>, meta: { noData?: boolean }) => void,
      onError: (message: string) => void,
    ) => void;
  },
  ticker: string,
  resolution: string,
  from: number,
  to: number,
  countBack: number,
) {
  return new Promise<{ bars: Array<{ time: number; close: number }>; meta: { noData?: boolean } }>((done, reject) => {
    feed.getBars({ ticker }, resolution, { from, to, countBack }, (bars, meta) => done({ bars, meta }), reject);
  });
}

describe("resolved series library feed", () => {
  test("gives every plotted series its own library symbol", () => {
    const feed = createResolvedSeriesLibraryFeed();
    const date = new Date(Date.UTC(2024, 0, 2));
    feed.setSeries([
      { id: "a", label: "Yes price", style: "line", points: [point(2, 40)] },
      { id: "b", label: "Yes price", style: "candles", points: [{ date, observedAt: date, value: 1, close: 1 }] },
    ]);
    expect(feed.model()).toEqual({
      symbol: "YES_PRICE",
      compares: ["YES_PRICE_2"],
      chartStyle: "line",
      priceScale: "normal",
    });
    feed.setSeries([
      { id: "c", label: "OWID:life-expectancy:USA", style: "line", points: [point(2, 70)] },
    ]);
    expect(feed.model().symbol).toBe("OWID:LIFE_EXPECTANCY_USA");
    expect(librarySafeTicker("Life expectancy · USA")).toBe("LIFE_EXPECTANCY_USA");
  });

  test("maps library intervals and keeps countBack bars before the requested window", () => {
    expect(resolutionFromLibraryInterval("240")).toBe("4h");
    expect(resolutionFromLibraryInterval("W")).toBe("1wk");
    const points = [point(1, 1), point(2, 2), point(3, 3), point(4, 4)];
    const from = points[2]!.date.getTime();
    const to = points[3]!.date.getTime() + 1;
    expect(selectLibraryBars(points, from, to, 3).map((bar) => bar.close)).toEqual([2, 3, 4]);
    expect(barFromPoint({ ...point(1, 5), open: null, high: null, low: null })).toMatchObject({
      open: 5,
      high: 5,
      low: 5,
      close: 5,
    });
  });

  test("buckets a weekly request onto Monday and refuses a finer interval than the stored bars", async () => {
    const resolved = createResolvedSeriesLibraryFeed();
    resolved.setSeries([{ id: "market", label: "Diesel", style: "line", points: weekPoints() }]);
    const from = Date.parse("2026-09-01T00:00:00.000Z") / 1000;
    const to = Date.parse("2026-10-02T00:00:00.000Z") / 1000;
    const weekly = await readBars(resolved.feed, resolved.model().symbol, "1W", from, to, 10);
    expect(weekly.bars.map((bar) => bar.close)).toEqual([12, 20, 99]);
    expect(new Date(weekly.bars[2]!.time).toISOString()).toBe("2026-09-28T00:00:00.000Z");

    resolved.setSeries([{
      id: "daily",
      label: "Daily",
      style: "line",
      points: [1, 2, 3, 4, 5].map((day) => point(day, day)),
    }]);
    const dailyFrom = Date.UTC(2024, 0, 1) / 1000;
    const dailyTo = Date.UTC(2024, 0, 6) / 1000;
    const minutes = await readBars(resolved.feed, resolved.model().symbol, "1", dailyFrom, dailyTo, 10);
    expect(minutes.bars).toEqual([]);
    expect(minutes.meta.noData).toBe(true);
    const days = await readBars(resolved.feed, resolved.model().symbol, "D", dailyFrom, dailyTo, 10);
    expect(days.bars.map((bar) => bar.close)).toEqual([1, 2, 3, 4, 5]);
  });

  test("defers getBars and the first subscribe tick, then resets or ticks later updates", async () => {
    const time = Date.UTC(2024, 0, 2);
    const resolved = createResolvedSeriesLibraryFeed();
    resolved.setSeries([{ id: "a", label: "Apple", style: "line", points: [point(2, 4)] }]);
    const symbol = resolved.model().symbol;
    let phase = "sync";
    const calls: string[] = [];
    resolved.feed.getBars(
      { ticker: symbol },
      "D",
      { from: 0, to: time / 1000 + 86_400, countBack: 10 },
      (bars) => calls.push(`${phase}:${bars.map((bar) => bar.close).join(",")}`),
      () => { throw new Error("resolved getBars failed"); },
    );
    expect(calls).toEqual([]);
    phase = "later";
    await nextMacrotask();
    expect(calls).toEqual(["later:4"]);

    phase = "sync";
    const ticks: string[] = [];
    resolved.feed.subscribeBars(
      { ticker: symbol },
      "D",
      (bar) => ticks.push(`${phase}:${bar.close}`),
      "resolved-apple",
      () => {},
    );
    expect(ticks).toEqual([]);
    phase = "later";
    await nextMacrotask();
    expect(ticks).toEqual(["later:4"]);

    const seriesTicks: number[] = [];
    const seriesResets: number[] = [];
    resolved.setSeries([{ id: "a", label: "AAPL", style: "line", points: [point(1, 1), point(2, 2)] }]);
    const renamed = resolved.model().symbol;
    resolved.feed.subscribeBars(
      { ticker: renamed },
      "1D",
      (next) => seriesTicks.push(next.close),
      "series",
      () => seriesResets.push(1),
    );
    await nextMacrotask();
    seriesTicks.length = 0;
    resolved.setSeries([{ id: "a", label: "AAPL", style: "line", points: [point(1, 1), point(2, 2), point(3, 3)] }]);
    expect(seriesTicks).toEqual([]);
    expect(seriesResets).toEqual([1]);
    resolved.setSeries([{ id: "a", label: "AAPL", style: "line", points: [point(1, 1), point(2, 8)] }]);
    expect(seriesTicks).toEqual([]);
    expect(seriesResets).toEqual([1, 1]);
    resolved.setSeries([{ id: "a", label: "AAPL", style: "line", points: [point(1, 1), point(2, 5)] }]);
    expect(seriesTicks).toEqual([5]);
    expect(seriesResets).toEqual([1, 1]);
  });

  test("advertises intraday resolutions only when the stored cadence supports them", async () => {
    const resolved = createResolvedSeriesLibraryFeed();
    const bars = (step: number) => Array.from({ length: 5 }, (_, index) => {
      const time = Date.UTC(2026, 0, 1) + index * step;
      return { date: new Date(time), observedAt: new Date(time), value: 1, close: 1 };
    });
    resolved.setSeries([{ id: "hourly", label: "Hourly", style: "line", points: bars(3_600_000) }]);
    const hourly = await new Promise<Record<string, unknown>>((done, reject) => {
      resolved.feed.resolveSymbol(resolved.model().symbol, done, reject);
    });
    expect(hourly.supported_resolutions).toEqual(["60", "240", "D", "W", "M"]);
    resolved.setSeries([{ id: "annual", label: "Annual", style: "line", points: bars(365 * 86_400_000) }]);
    const annual = await new Promise<Record<string, unknown>>((done, reject) => {
      resolved.feed.resolveSymbol(resolved.model().symbol, done, reject);
    });
    expect(annual.supported_resolutions).toEqual(["D", "W", "M"]);
  });
});
