import { describe, expect, test } from "bun:test";
import { createResolvedSeriesLibraryFeed } from "../../plugins/builtin/chart-composer/charting-library-feed";
import type { ChartSharePoint, ChartShareSeries } from "../../shares/payload";
import { shareLegendSeries, shareLibraryInterval, shareLibrarySeries } from "./chart-view";

function series(overrides: Partial<ChartShareSeries> = {}): ChartShareSeries {
  return {
    id: "s1",
    label: "S1",
    color: "#6aa3e6",
    style: "line",
    axis: "right",
    panelId: "price",
    points: [],
    ...overrides,
  };
}

function point(partial: ChartSharePoint): ChartSharePoint {
  return partial;
}

const INTERVAL_GAPS = [
  [90_000, "1"],
  [360_000, "5"],
  [1_200_000, "15"],
  [2_400_000, "30"],
  [3_000_000, "45"],
  [5_400_000, "60"],
  [18_000_000, "240"],
  [172_800_000, "D"],
  [1_209_600_000, "W"],
] as const;

describe("shareLibraryInterval", () => {
  test("defaults to daily when there is one point or no positive gap", () => {
    expect(shareLibraryInterval([])).toBe("D");
    expect(shareLibraryInterval([1_000])).toBe("D");
    expect(shareLibraryInterval([1_000, 1_000])).toBe("D");
    expect(shareLibraryInterval([Number.NaN, Number.POSITIVE_INFINITY])).toBe("D");
  });

  test("uses the first matching max gap, then monthly", () => {
    for (let index = 0; index < INTERVAL_GAPS.length; index += 1) {
      const [maxGap, interval] = INTERVAL_GAPS[index]!;
      const next = INTERVAL_GAPS[index + 1]?.[1] ?? "M";
      expect(shareLibraryInterval([0, maxGap])).toBe(interval);
      expect(shareLibraryInterval([0, maxGap + 1])).toBe(next);
    }
  });

  test("takes the median gap after sorting point times", () => {
    expect(shareLibraryInterval([420_000, 0, 60_000])).toBe("5");
    expect(shareLibraryInterval([0, 0, 90_000])).toBe("1");
  });
});

describe("share library series", () => {
  test("plots every finite price series and keeps the legend on what is drawn", () => {
    const aapl = series({
      id: "aapl",
      label: "AAPL",
      style: "candles",
      unit: "USD",
      points: [
        point({ t: 0, o: 1, h: 4, l: 0.5, c: 2 }),
        point({ t: 86_400_000, v: 1, c: 3 }),
      ],
    });
    const blank = series({
      id: "blank",
      label: "Blank",
      points: [{ t: 1 }, { t: 2, v: null }, { t: Number.NaN, v: 5 }],
    });
    const once = series({
      id: "once",
      label: "Once",
      points: [{ t: 5, v: 7 }],
    });
    const msft = series({
      id: "msft",
      label: "MSFT",
      style: "ohlc",
      unit: "%",
      points: [
        { t: 0, v: 10 },
        { t: 86_400_000, v: 11 },
      ],
    });
    const hlc = series({
      id: "hlc",
      label: "HLC",
      style: "hlc",
      points: [
        { t: 0, v: 1 },
        { t: 3_600_000, v: 2 },
      ],
    });
    const all = [blank, aapl, once, msft, hlc];
    const plotted = shareLibrarySeries(all);

    expect(plotted.map((entry) => entry.id)).toEqual(["aapl", "once", "msft", "hlc"]);
    expect(plotted[0]!.style).toBe("candles");
    expect(plotted[0]!.points[0]).toMatchObject({
      date: new Date(0),
      observedAt: new Date(0),
      value: 2,
      close: 2,
      open: 1,
      high: 4,
      low: 0.5,
    });
    expect(plotted[0]!.points[1]!.close).toBe(3);
    expect(plotted[1]!.points[0]!.value).toBe(7);
    expect(plotted[2]).toMatchObject({ style: "ohlc", unit: "%" });
    expect(plotted[2]!.points[0]).toMatchObject({ value: 10, close: 10 });
    expect(plotted[3]!.style).toBe("hlc");
    expect(shareLibraryInterval(plotted[0]!.points.map((entry) => entry.date.getTime()))).toBe("D");

    const feed = createResolvedSeriesLibraryFeed();
    feed.setSeries(plotted);
    expect(feed.model()).toMatchObject({
      symbol: "AAPL",
      compares: ["ONCE", "MSFT", "HLC"],
      chartStyle: "candles",
      priceScale: "percentage",
    });

    const lineFeed = createResolvedSeriesLibraryFeed();
    lineFeed.setSeries(shareLibrarySeries([once]));
    expect(lineFeed.model().chartStyle).toBe("line");
    const hlcFeed = createResolvedSeriesLibraryFeed();
    hlcFeed.setSeries(shareLibrarySeries([hlc]));
    expect(hlcFeed.model().chartStyle).toBe("candles");
    const ohlcFeed = createResolvedSeriesLibraryFeed();
    ohlcFeed.setSeries(shareLibrarySeries([msft]));
    expect(ohlcFeed.model().chartStyle).toBe("candles");

    expect(shareLegendSeries(all, "library").map((entry) => entry.id)).toEqual(["aapl", "once", "msft", "hlc"]);
    expect(shareLegendSeries(all, "polyline").map((entry) => entry.id)).toEqual(["aapl", "msft", "hlc"]);
  });
});
