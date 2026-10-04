import { describe, expect, test } from "bun:test";
import {
  barFromPoint,
  createResolvedSeriesLibraryFeed,
  createSpecLibraryFeed,
  createStaticLibraryFeed,
  feedTickerForSource,
  libraryChartFromSpec,
  librarySafeTicker,
  resolutionFromLibraryInterval,
  selectLibraryBars,
} from "./charting-library-feed";
import { DEFAULT_CHART_RESOLUTION_SUPPORT } from "../../../time-series/resolution";
import { CHART_SPEC_VERSION, type ChartSeriesSource, type ChartSpec, type TimeSeriesPoint } from "../../../time-series/types";
import type { DataProvider } from "../../../types/data-provider";
import type { PricePoint } from "../../../types/financials";

function point(day: number, close: number, open?: number): TimeSeriesPoint {
  const date = new Date(Date.UTC(2024, 0, day));
  return { date, observedAt: date, value: close, close, open: open ?? close, high: close, low: open ?? close };
}

describe("charting library feed", () => {
  test("names futures, macro series, and prediction markets with our own tickers", () => {
    expect(feedTickerForSource({
      kind: "security",
      instrument: { symbol: "MGE=F" },
      fieldId: "market.ohlcv",
    })).toBe("MGE=F");
    expect(feedTickerForSource({
      kind: "economic",
      provider: "fred",
      seriesId: "CPIAUCSL",
    })).toBe("FRED:CPIAUCSL");
    expect(feedTickerForSource({
      kind: "prediction-market",
      venue: "kalshi",
      marketId: "KXTEST",
    })).toBe("KALSHI:KXTEST");
    expect(feedTickerForSource({ kind: "constant", value: 1 })).toBeNull();
    expect(feedTickerForSource({
      kind: "adjacent-index",
      indexId: "sea_nti_mv",
    })).toBe("ADJ:SEA_NTI_MV");
    expect(feedTickerForSource({
      kind: "adjacent-index",
      indexId: "red-tr",
    })).toBe("ADJ:RED_TR");
    expect(feedTickerForSource({
      kind: "owid",
      slug: "life-expectancy",
      entity: "USA",
    })).toBe("OWID:LIFE_EXPECTANCY_USA");
    expect(feedTickerForSource({
      kind: "owid",
      slug: "life-expectancy",
      entity: "OWID_WRL",
    })).toBe("OWID:LIFE_EXPECTANCY_OWID_WRL");
    expect(feedTickerForSource({
      kind: "poll",
      subject: "Donald Trump",
      choice: "Approve",
    })).toBe("POLL:DONALD_TRUMP_APPROVE");
    expect(feedTickerForSource({
      kind: "benchmark",
      selector: "OpenAI",
      metric: "mmlu",
    })).toBe("BENCH:OPENAI_MMLU");
    expect(feedTickerForSource({
      kind: "weather",
      provider: "twc-kalshi",
      stationId: "KNYC",
      metric: "high",
    })).toBe("WX:TWC_KALSHI_KNYC_HIGH");
    expect(feedTickerForSource({
      kind: "prediction-market",
      venue: "kalshi",
      marketId: "KXNOMINEE-VANCE",
    })).toBe("KALSHI:KXNOMINEE_VANCE");
    expect(feedTickerForSource({
      kind: "prediction-market",
      venue: "polymarket",
      marketId: "will-trump-win",
    })).toBe("POLYMARKET:WILL_TRUMP_WIN");
    expect(feedTickerForSource({
      kind: "capability",
      capabilityId: "defi-llama",
      seriesId: "tvl-ethereum",
    })).toBe("CAP:DEFI_LLAMA_TVL_ETHEREUM");
    expect(feedTickerForSource({
      kind: "economic",
      provider: "fred",
      seriesId: "CPI AUCSL",
    })).toBe("FRED:CPI_AUCSL");
    expect(feedTickerForSource({
      kind: "economic",
      provider: "fred",
      seriesId: "SOME-SERIES",
    })).toBe("FRED:SOME_SERIES");
    expect(feedTickerForSource({
      kind: "weather",
      provider: "nws-cli",
      stationId: "KNYC",
      metric: "high",
    })).toBe("WX:NWS_CLI_KNYC_HIGH");
  });

  test("resolves an OWID series from the safe ticker and from the raw expression", async () => {
    const source: ChartSeriesSource = { kind: "owid", slug: "life-expectancy", entity: "USA" };
    const spec: ChartSpec = {
      version: CHART_SPEC_VERSION,
      viewport: { range: "ALL", resolution: "auto" },
      panels: [{ id: "main", height: 1, scale: "linear" }],
      series: [{
        id: "owid",
        source,
        style: "line",
        transform: "raw",
        axis: "auto",
        panelId: "main",
        interpolation: "none",
      }],
      studies: [],
    };
    const model = libraryChartFromSpec(spec);
    expect(model?.symbol).toBe("OWID:LIFE_EXPECTANCY_USA");
    expect(model?.directory.get("OWID:LIFE_EXPECTANCY_USA")).toEqual(source);
    const seen: ChartSeriesSource[] = [];
    const feed = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => ({
        dataProvider: null,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
        loadUniversalSeries: (loaded) => {
          seen.push(loaded);
          const date = new Date(Date.UTC(2020, 0, 1));
          return Promise.resolve({ points: [{ date, observedAt: date, value: 78.9 }] });
        },
      }),
    });
    const resolve = (symbolName: string) => new Promise<Record<string, unknown>>((done, reject) => {
      feed.feed.resolveSymbol(symbolName, done, reject);
    });
    const fromSafe = await resolve("OWID:LIFE_EXPECTANCY_USA");
    const fromRaw = await resolve("OWID:LIFE-EXPECTANCY:USA");
    expect(fromSafe.ticker).toBe("OWID:LIFE_EXPECTANCY_USA");
    expect(fromSafe.name).toBe("LIFE_EXPECTANCY_USA");
    expect(fromSafe.description).toBe("life expectancy USA");
    expect(fromSafe.supported_resolutions).toEqual(["D", "W", "M"]);
    expect(fromRaw.ticker).toBe("OWID:LIFE_EXPECTANCY_USA");
    expect(String(fromSafe.name)).not.toContain(":");
    expect(String(fromSafe.name)).not.toContain("-");
    const from = Date.UTC(2019, 0, 1) / 1000;
    const to = Date.UTC(2021, 0, 1) / 1000;
    const bars = await new Promise<Array<{ close: number }>>((done, reject) => {
      feed.feed.getBars(
        { ticker: "OWID:LIFE_EXPECTANCY_USA" },
        "D",
        { from, to, countBack: 10 },
        (next) => done(next),
        reject,
      );
    });
    expect(seen).toEqual([source]);
    expect(bars.map((bar) => bar.close)).toEqual([78.9]);
    expect(librarySafeTicker("POLL:Donald Trump:Approve")).toBe("POLL:DONALD_TRUMP_APPROVE");
    expect(librarySafeTicker("Life expectancy · USA")).toBe("LIFE_EXPECTANCY_USA");
  });

  test("returns a yearly OWID print when the first visible window is later", async () => {
    const source: ChartSeriesSource = {
      kind: "owid",
      slug: "share-of-population-in-extreme-poverty",
      entity: "OWID_WRL",
    };
    const model = libraryChartFromSpec(singleSpec(source));
    expect(model?.symbol).toBe("OWID:SHARE_OF_POPULATION_IN_EXTREME_POVERTY_OWID_WRL");
    const feed = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => ({
        dataProvider: null,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
        loadUniversalSeries: () => {
          const date = new Date(Date.UTC(2015, 0, 1));
          return Promise.resolve({ points: [{ date, observedAt: date, value: 10.4 }] });
        },
      }),
    });
    const from = Date.UTC(2025, 0, 1) / 1000;
    const to = Date.UTC(2026, 0, 1) / 1000;
    const result = await readBarResult(feed.feed, model!.symbol, "M", from, to, 300);
    expect(result.meta.noData).toBe(false);
    expect(result.bars.map((bar) => bar.close)).toEqual([10.4]);
    expect(result.bars[0]?.time).toBe(Date.UTC(2015, 0, 1));
  });

  test("resolves an adjacent index when the library uppercases the ticker", async () => {
    const spec: ChartSpec = {
      version: CHART_SPEC_VERSION,
      viewport: { range: "1M", resolution: "auto" },
      panels: [{ id: "main", height: 1, scale: "linear" }],
      series: [{
        id: "index",
        source: { kind: "adjacent-index", indexId: "sea_nti_mv" },
        style: "line",
        transform: "raw",
        axis: "auto",
        panelId: "main",
        interpolation: "none",
      }],
      studies: [],
    };
    const model = libraryChartFromSpec(spec);
    expect(model?.symbol).toBe("ADJ:SEA_NTI_MV");
    const feed = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => ({ dataProvider: null, loadFredSeries: async () => { throw new Error("resolve must not load bars"); } }),
    });
    const resolved = await new Promise<Record<string, unknown>>((resolve, reject) => {
      feed.feed.resolveSymbol("ADJ:sea_nti_mv", resolve, reject);
    });
    expect(resolved.ticker).toBe("ADJ:SEA_NTI_MV");
    expect(model?.directory.get("ADJ:SEA_NTI_MV")).toEqual({ kind: "adjacent-index", indexId: "sea_nti_mv" });
  });

  test("charts a price spec as candles and a prediction spec as a step line", () => {
    const price: ChartSpec = {
      version: CHART_SPEC_VERSION,
      viewport: { range: "1M", resolution: "auto" },
      panels: [{ id: "main", height: 1, scale: "linear" }],
      series: [{
        id: "price",
        source: { kind: "security", instrument: { symbol: "AAPL", exchange: "NASDAQ" }, fieldId: "market.ohlcv" },
        style: "candles",
        transform: "raw",
        axis: "auto",
        panelId: "main",
        interpolation: "none",
      }],
      studies: [],
    };
    const model = libraryChartFromSpec(price);
    expect(model?.symbol).toBe("NASDAQ:AAPL");
    expect(model?.chartStyle).toBe("candles");
    expect(model?.interval).toBe("240");
    expect(libraryChartFromSpec({
      ...price,
      series: [{ ...price.series[0]!, style: "line" }],
    })?.chartStyle).toBe("line");

    const prediction: ChartSpec = {
      ...price,
      series: [{
        ...price.series[0]!,
        source: { kind: "prediction-market", venue: "kalshi", marketId: "KXTEST" },
        style: "line",
      }],
    };
    expect(libraryChartFromSpec(prediction)?.chartStyle).toBe("step");
    expect(libraryChartFromSpec(prediction)?.priceScale).toBe("normal");
    const compared = libraryChartFromSpec({
      ...price,
      series: [
        price.series[0]!,
        {
          ...price.series[0]!,
          id: "other",
          source: { kind: "security", instrument: { symbol: "MSFT", exchange: "NASDAQ" }, fieldId: "market.ohlcv" },
        },
      ],
    });
    expect(compared?.priceScale).toBe("percentage");
    expect(compared?.compares).toEqual(["NASDAQ:MSFT"]);
  });

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

  test("asks for five years of weekly history when the visible window would otherwise load the full range", async () => {
    const ranges: string[] = [];
    const source: ChartSeriesSource = {
      kind: "security",
      instrument: { symbol: "AAPL", exchange: "NMS" },
      fieldId: "market.ohlcv",
    };
    const spec: ChartSpec = {
      version: CHART_SPEC_VERSION,
      viewport: { range: "1Y", resolution: "1wk" },
      panels: [{ id: "main", height: 1, scale: "linear" }],
      series: [{
        id: "price",
        source,
        style: "candles",
        transform: "raw",
        axis: "auto",
        panelId: "main",
        interpolation: "none",
      }],
      studies: [],
    };
    const model = libraryChartFromSpec(spec);
    const provider = {
      id: "weekly-cap",
      name: "weekly-cap",
      getChartResolutionSupport: () => DEFAULT_CHART_RESOLUTION_SUPPORT,
      getPriceHistory: () => Promise.reject(new Error("range history should not run")),
      getPriceHistoryForResolution: (_ticker: string, _exchange: string, range: string) => {
        ranges.push(range);
        return Promise.resolve(range === "5Y" ? weeklyPrices() : quarterlyPrices());
      },
    } as DataProvider;
    const feed = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => ({
        dataProvider: provider,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
        now: new Date("2026-10-02T20:00:00.000Z"),
      }),
    });
    const from = Date.parse("2025-11-21T00:00:00.000Z") / 1000;
    const to = Date.parse("2026-10-02T00:00:00.000Z") / 1000;
    const bars = await readBars(feed.feed, "NMS:AAPL", "1W", from, to, 45);
    expect(ranges).toEqual(["5Y"]);
    expect(bars.length).toBeGreaterThan(40);
    expect(dayGaps(bars)).toEqual(Array(bars.length - 1).fill(7));
  });

  test("buckets a weekly request onto Monday and keeps a print from later that Friday", async () => {
    const points = weekPoints();
    const from = Date.parse("2026-09-01T00:00:00.000Z") / 1000;
    const to = Date.parse("2026-10-02T00:00:00.000Z") / 1000;
    const source: ChartSeriesSource = {
      kind: "prediction-market",
      venue: "kalshi",
      marketId: "KXDIESELMON-26SEP30-T4.70",
    };
    const spec: ChartSpec = {
      version: CHART_SPEC_VERSION,
      viewport: { range: "1M", resolution: "1wk" },
      panels: [{ id: "main", height: 1, scale: "linear" }],
      series: [{
        id: "market",
        source,
        style: "line",
        transform: "raw",
        axis: "auto",
        panelId: "main",
        interpolation: "none",
      }],
      studies: [],
    };
    const model = libraryChartFromSpec(spec);
    const feed = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => ({
        dataProvider: null,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
        loadUniversalSeries: () => Promise.resolve({ points: [...points] }),
        now: new Date("2026-10-02T20:00:00.000Z"),
      }),
    });
    const weekly = await readBars(feed.feed, "KALSHI:KXDIESELMON_26SEP30_T4.70", "W", from, to, 10);
    expect(weekly.map((bar) => new Date(bar.time).toISOString())).toEqual([
      "2026-09-14T00:00:00.000Z",
      "2026-09-21T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    ]);
    expect(weekly[0]).toMatchObject({ open: 9, high: 14, low: 8, close: 12, volume: 3 });
    expect(weekly[2]).toMatchObject({ open: 90, high: 99, low: 88, close: 99, volume: 7 });

    const hourly = await readBars(feed.feed, "KALSHI:KXDIESELMON_26SEP30_T4.70", "240", from, to, 10);
    expect(hourly.map((bar) => new Date(bar.time).toISOString())).toEqual([
      "2026-09-15T04:00:00.000Z",
      "2026-09-16T04:00:00.000Z",
      "2026-09-24T04:00:00.000Z",
    ]);

    const resolved = createResolvedSeriesLibraryFeed();
    resolved.setSeries([{ id: "market", label: "Diesel", style: "line", points }]);
    const fromResolved = await readBars(resolved.feed, resolved.model().symbol, "1W", from, to, 10);
    expect(fromResolved.map((bar) => bar.close)).toEqual([12, 20, 99]);
    expect(new Date(fromResolved[2]!.time).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  test("defers in-memory getBars and the initial subscribeBars tick to a macrotask", async () => {
    const time = Date.UTC(2024, 0, 2);
    const staticFeed = createStaticLibraryFeed("AAPL", "Apple");
    staticFeed.setBars([{ time, open: 1, high: 2, low: 1, close: 3 }]);
    const staticCalls: string[] = [];
    let phase = "sync";
    staticFeed.feed.getBars(
      { ticker: "AAPL" },
      "D",
      { from: 0, to: time / 1000 + 86_400, countBack: 10 },
      (bars) => staticCalls.push(`${phase}:${bars.map((bar) => bar.close).join(",")}`),
      () => { throw new Error("static getBars failed"); },
    );
    expect(staticCalls).toEqual([]);
    phase = "later";
    await nextMacrotask();
    expect(staticCalls).toEqual(["later:3"]);

    phase = "sync";
    const staticTicks: string[] = [];
    staticFeed.feed.subscribeBars(
      { ticker: "AAPL" },
      "D",
      (bar) => staticTicks.push(`${phase}:${bar.close}`),
      "static-aapl",
      () => {},
    );
    expect(staticTicks).toEqual([]);
    phase = "later";
    await nextMacrotask();
    expect(staticTicks).toEqual(["later:3"]);

    const resolved = createResolvedSeriesLibraryFeed();
    resolved.setSeries([{ id: "a", label: "Apple", style: "line", points: [point(2, 4)] }]);
    const symbol = resolved.model().symbol;
    phase = "sync";
    const resolvedCalls: string[] = [];
    resolved.feed.getBars(
      { ticker: symbol },
      "D",
      { from: 0, to: time / 1000 + 86_400, countBack: 10 },
      (bars) => resolvedCalls.push(`${phase}:${bars.map((bar) => bar.close).join(",")}`),
      () => { throw new Error("resolved getBars failed"); },
    );
    const emptyCalls: string[] = [];
    resolved.feed.getBars(
      { ticker: "NO_SUCH" },
      "D",
      { from: 0, to: 1, countBack: 1 },
      () => emptyCalls.push(phase),
      () => { throw new Error("missing symbol should be empty"); },
    );
    expect(resolvedCalls).toEqual([]);
    expect(emptyCalls).toEqual([]);
    phase = "later";
    await nextMacrotask();
    expect(resolvedCalls).toEqual(["later:4"]);
    expect(emptyCalls).toEqual(["later"]);

    phase = "sync";
    const resolvedTicks: string[] = [];
    resolved.feed.subscribeBars(
      { ticker: symbol },
      "D",
      (bar) => resolvedTicks.push(`${phase}:${bar.close}`),
      "resolved-apple",
      () => {},
    );
    expect(resolvedTicks).toEqual([]);
    phase = "later";
    await nextMacrotask();
    expect(resolvedTicks).toEqual(["later:4"]);
  });

  test("does not resolve spec getBars inside the calling turn", async () => {
    const source: ChartSeriesSource = { kind: "poll", subject: "Test", choice: "Yes" };
    const model = libraryChartFromSpec(singleSpec(source));
    const loaded = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => ({
        dataProvider: null,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
        loadUniversalSeries: () => Promise.resolve({ points: [point(2, 5)] }),
      }),
    });
    const failed = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => ({
        dataProvider: null,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
        loadUniversalSeries: () => Promise.reject(new Error("poll failed")),
      }),
    });
    let result = "pending";
    let error = "pending";
    loaded.feed.getBars(
      { ticker: model!.symbol },
      "D",
      { from: 0, to: Date.UTC(2024, 1, 1) / 1000, countBack: 5 },
      () => { result = "called"; },
      () => { result = "called"; },
    );
    failed.feed.getBars(
      { ticker: model!.symbol },
      "D",
      { from: 0, to: Date.UTC(2024, 1, 1) / 1000, countBack: 5 },
      () => { error = "called"; },
      () => { error = "called"; },
    );
    expect(result).toBe("pending");
    expect(error).toBe("pending");
    await nextMacrotask();
    expect(result).toBe("pending");
    expect(error).toBe("pending");
    await nextMacrotask();
    expect(result).toBe("called");
    expect(error).toBe("called");
  });

  test("resets the cache for a new history and ticks only an in-place last bar", async () => {
    const staticFeed = createStaticLibraryFeed("AAPL", "Apple");
    const ticks: number[] = [];
    const resets: number[] = [];
    const otherTicks: number[] = [];
    const otherResets: number[] = [];
    const t0 = Date.UTC(2024, 0, 1);
    const t1 = Date.UTC(2024, 0, 2);
    const t2 = Date.UTC(2024, 0, 3);
    const t3 = Date.UTC(2024, 0, 4);
    const bar = (time: number, close: number) => ({ time, open: 1, high: 4, low: 1, close });
    staticFeed.setBars([bar(t0, 1), bar(t1, 2)]);
    staticFeed.feed.subscribeBars(
      { ticker: "AAPL" },
      "D",
      (next) => ticks.push(next.close),
      "aapl",
      () => resets.push(1),
    );
    staticFeed.feed.subscribeBars(
      { ticker: "MSFT" },
      "D",
      (next) => otherTicks.push(next.close),
      "msft",
      () => otherResets.push(1),
    );
    await nextMacrotask();
    expect(ticks).toEqual([2]);
    expect(otherTicks).toEqual([]);
    ticks.length = 0;

    staticFeed.setBars([bar(t0, 1), bar(t1, 2), bar(t2, 3)]);
    expect(ticks).toEqual([]);
    expect(resets).toEqual([1]);
    expect(otherResets).toEqual([]);

    staticFeed.setBars([bar(t1, 1), bar(t2, 3)]);
    expect(ticks).toEqual([]);
    expect(resets).toEqual([1, 1]);

    staticFeed.setBars([bar(t1, 1), bar(t3, 3)]);
    expect(ticks).toEqual([]);
    expect(resets).toEqual([1, 1, 1]);

    staticFeed.setBars([bar(t1, 1), bar(t3, 9)]);
    expect(ticks).toEqual([9]);
    expect(resets).toEqual([1, 1, 1]);
    expect(otherTicks).toEqual([]);
    expect(otherResets).toEqual([]);

    const resolved = createResolvedSeriesLibraryFeed();
    resolved.setSeries([{ id: "a", label: "AAPL", style: "line", points: [point(1, 1), point(2, 2)] }]);
    const symbol = resolved.model().symbol;
    const seriesTicks: number[] = [];
    const seriesResets: number[] = [];
    resolved.feed.subscribeBars(
      { ticker: symbol },
      "1D",
      (next) => seriesTicks.push(next.close),
      "series",
      () => seriesResets.push(1),
    );
    await nextMacrotask();
    expect(seriesTicks).toEqual([2]);
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

  test("publish ticks every listener for a symbol unless the resolution narrows the bar size", () => {
    const source: ChartSeriesSource = {
      kind: "security",
      instrument: { symbol: "AAPL", exchange: "NASDAQ" },
      fieldId: "market.ohlcv",
    };
    const model = libraryChartFromSpec(singleSpec(source));
    const feed = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => { throw new Error("publish does not load bars"); },
    });
    const symbol = model!.symbol;
    const closes = { D: [] as number[], oneD: [] as number[], hour: [] as number[], unknown: [] as number[] };
    const bar = (close: number) => ({ time: Date.UTC(2024, 0, 2), open: 1, high: 1, low: 1, close });
    feed.feed.subscribeBars({ ticker: symbol }, "D", (next) => closes.D.push(next.close), "d", () => {});
    feed.feed.subscribeBars({ ticker: symbol }, "1D", (next) => closes.oneD.push(next.close), "1d", () => {});
    feed.feed.subscribeBars({ ticker: symbol }, "60", (next) => closes.hour.push(next.close), "60", () => {});
    feed.feed.subscribeBars({ ticker: symbol }, "2", (next) => closes.unknown.push(next.close), "2", () => {});

    feed.publish(symbol, bar(10));
    expect(closes).toEqual({ D: [10], oneD: [10], hour: [10], unknown: [10] });

    feed.publish(symbol, bar(11), "D");
    expect(closes).toEqual({ D: [10, 11], oneD: [10, 11], hour: [10], unknown: [10] });

    feed.publish(symbol, bar(12), "60");
    expect(closes).toEqual({ D: [10, 11], oneD: [10, 11], hour: [10, 12], unknown: [10] });

    feed.publish(symbol, bar(13), "1D");
    expect(closes.D).toEqual([10, 11, 13]);
    expect(closes.oneD).toEqual([10, 11, 13]);
    expect(closes.hour).toEqual([10, 12]);

    feed.publish(symbol, bar(14), "2");
    expect(closes.unknown).toEqual([10]);
    expect(closes.D).toEqual([10, 11, 13]);
  });

  test("rewrites hyphenated security tickers and keeps the Yahoo symbol", async () => {
    const brk: ChartSeriesSource = {
      kind: "security",
      instrument: { symbol: "BRK-B", exchange: "NYSE" },
      fieldId: "market.ohlcv",
    };
    const brkBare: ChartSeriesSource = {
      kind: "security",
      instrument: { symbol: "BRK-B" },
      fieldId: "market.ohlcv",
    };
    const future: ChartSeriesSource = {
      kind: "security",
      instrument: { symbol: "MGE=F", exchange: "CME" },
      fieldId: "market.ohlcv",
    };
    expect(feedTickerForSource(brkBare)).toBe("BRK_B");
    expect(feedTickerForSource(brk)).toBe("NYSE:BRK_B");
    expect(feedTickerForSource({
      kind: "security",
      instrument: { symbol: "BTC-USD" },
      fieldId: "market.ohlcv",
    })).toBe("BTC_USD");
    expect(feedTickerForSource({
      kind: "security",
      instrument: { symbol: "MGE=F" },
      fieldId: "market.ohlcv",
    })).toBe("MGE=F");
    expect(feedTickerForSource(future)).toBe("CME:MGE=F");

    const brkModel = libraryChartFromSpec(singleSpec(brk));
    expect(brkModel?.symbol).toBe("NYSE:BRK_B");
    expect(brkModel?.directory.get("NYSE:BRK_B")).toEqual(brk);
    const futureModel = libraryChartFromSpec(singleSpec(future));
    expect(futureModel?.symbol).toBe("CME:MGE=F");
    expect(futureModel?.directory.get("CME:MGE=F")).toEqual(future);

    const seen: string[] = [];
    const provider = {
      id: "yahoo",
      name: "yahoo",
      getChartResolutionSupport: () => DEFAULT_CHART_RESOLUTION_SUPPORT,
      getPriceHistory: (symbol: string) => {
        seen.push(symbol);
        return Promise.reject(new Error("range history should not run"));
      },
      getPriceHistoryForResolution: (symbol: string) => {
        seen.push(symbol);
        const date = new Date(Date.UTC(2024, 0, 2));
        return Promise.resolve([{ date, open: 1, high: 2, low: 1, close: 1, volume: 1 }]);
      },
    } as DataProvider;
    const from = Date.UTC(2024, 0, 1) / 1000;
    const to = Date.UTC(2024, 0, 10) / 1000;
    const brkFeed = createSpecLibraryFeed({
      getDirectory: () => brkModel!.directory,
      getSources: () => ({
        dataProvider: provider,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
      }),
    });
    const resolvedBrk = await new Promise<Record<string, unknown>>((resolve, reject) => {
      brkFeed.feed.resolveSymbol("NYSE:BRK-B", resolve, reject);
    });
    expect(resolvedBrk.ticker).toBe("NYSE:BRK_B");
    await readBars(brkFeed.feed, "NYSE:BRK_B", "D", from, to, 10);
    expect(seen).toEqual(["BRK-B"]);

    seen.length = 0;
    const futureFeed = createSpecLibraryFeed({
      getDirectory: () => futureModel!.directory,
      getSources: () => ({
        dataProvider: provider,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
      }),
    });
    const resolvedFuture = await new Promise<Record<string, unknown>>((resolve, reject) => {
      futureFeed.feed.resolveSymbol("CME:MGE=F", resolve, reject);
    });
    expect(resolvedFuture.ticker).toBe("CME:MGE=F");
    await readBars(futureFeed.feed, "CME:MGE=F", "D", from, to, 10);
    expect(seen).toEqual(["MGE=F"]);
  });

  test("aggregates static weeks onto Monday and returns noData for a finer request", async () => {
    const from = Date.parse("2026-09-01T00:00:00.000Z") / 1000;
    const to = Date.parse("2026-10-02T00:00:00.000Z") / 1000;
    const staticFeed = createStaticLibraryFeed("DIESEL", "Diesel");
    staticFeed.setBars(weekPoints().flatMap((item) => {
      const bar = barFromPoint(item);
      return bar ? [bar] : [];
    }));
    const weekly = await readBarResult(staticFeed.feed, "DIESEL", "W", from, to, 10);
    expect(weekly.bars.map((bar) => new Date(bar.time).toISOString())).toEqual([
      "2026-09-14T00:00:00.000Z",
      "2026-09-21T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    ]);
    expect(weekly.bars.map((bar) => bar.close)).toEqual([12, 20, 99]);
    const minutes = await readBarResult(staticFeed.feed, "DIESEL", "1", from, to, 10);
    expect(minutes.bars).toEqual([]);
    expect(minutes.meta.noData).toBe(true);

    const dailyFrom = Date.UTC(2023, 11, 1) / 1000;
    const dailyTo = Date.UTC(2024, 1, 1) / 1000;
    const daily = [1, 2, 3, 4, 5].map((day) => ({
      time: Date.UTC(2024, 0, day),
      open: day,
      high: day,
      low: day,
      close: day,
    }));
    staticFeed.setBars(daily);
    const days = await readBarResult(staticFeed.feed, "AAPL", "D", dailyFrom, dailyTo, 10);
    expect(days.meta.noData).toBeFalsy();
    expect(days.bars.map((bar) => bar.close)).toEqual([1, 2, 3, 4, 5]);
    const fourHour = await readBarResult(staticFeed.feed, "AAPL", "240", dailyFrom, dailyTo, 10);
    expect(fourHour.bars).toEqual([]);
    expect(fourHour.meta.noData).toBe(true);

    staticFeed.setBars([0, 1, 2, 3, 4].map((hour) => ({
      time: Date.UTC(2024, 0, 2, hour),
      open: hour,
      high: hour + 1,
      low: hour,
      close: hour + 0.5,
    })));
    const aggregated = await readBarResult(staticFeed.feed, "AAPL", "D", dailyFrom, dailyTo, 10);
    expect(aggregated.meta.noData).toBeFalsy();
    expect(aggregated.bars).toEqual([{
      time: Date.UTC(2024, 0, 2),
      open: 0,
      high: 5,
      low: 0,
      close: 4.5,
    }]);

    const resolved = createResolvedSeriesLibraryFeed();
    resolved.setSeries([{
      id: "daily",
      label: "Daily",
      style: "line",
      points: [1, 2, 3, 4, 5].map((day) => point(day, day)),
    }]);
    const resolvedMinutes = await readBarResult(resolved.feed, resolved.model().symbol, "1", dailyFrom, dailyTo, 10);
    expect(resolvedMinutes.bars).toEqual([]);
    expect(resolvedMinutes.meta.noData).toBe(true);
    const resolvedDays = await readBarResult(resolved.feed, resolved.model().symbol, "D", dailyFrom, dailyTo, 10);
    expect(resolvedDays.bars.map((bar) => bar.close)).toEqual([1, 2, 3, 4, 5]);

    staticFeed.setBars([{
      time: Date.UTC(2015, 0, 1),
      open: 9,
      high: 9,
      low: 9,
      close: 9,
    }]);
    const yearlyMonth = await readBarResult(
      staticFeed.feed,
      "AAPL",
      "M",
      Date.UTC(2025, 0, 1) / 1000,
      Date.UTC(2026, 0, 1) / 1000,
      50,
    );
    expect(yearlyMonth.meta.noData).toBeFalsy();
    expect(yearlyMonth.bars.map((bar) => bar.close)).toEqual([9]);
  });

  test("opens a New York stock on the extended session and leaves other listings on 24x7", async () => {
    const resolve = async (source: ChartSeriesSource) => {
      const model = libraryChartFromSpec(singleSpec(source));
      const feed = createSpecLibraryFeed({
        getDirectory: () => model!.directory,
        getSources: () => ({ dataProvider: null, loadFredSeries: async () => { throw new Error("resolve must not load bars"); } }),
      });
      return new Promise<Record<string, unknown>>((done, reject) => {
        feed.feed.resolveSymbol(model!.symbol, done, reject);
      });
    };
    const stock = await resolve({
      kind: "security",
      instrument: { symbol: "HOOD", exchange: "XNAS" },
      fieldId: "market.ohlcv",
    });
    expect(stock.session).toBe("0400-2000");
    expect(stock.subsession_id).toBe("extended");
    expect(stock.subsessions).toEqual([
      { description: "Regular Trading Hours", id: "regular", session: "0930-1600" },
      { description: "Extended Trading Hours", id: "extended", session: "0400-2000" },
      { description: "Pre-market", id: "premarket", session: "0400-0930" },
      { description: "Post-market", id: "postmarket", session: "1600-2000" },
    ]);
    expect(stock.intraday_multipliers).toEqual([]);
    const sessionSource: ChartSeriesSource = {
      kind: "security", instrument: { symbol: "NVDA", exchange: "XNAS" }, fieldId: "market.ohlcv",
    };
    const sessionModel = libraryChartFromSpec(singleSpec(sessionSource))!;
    const sessionFeed = createSpecLibraryFeed({
      getDirectory: () => sessionModel.directory,
      getSources: () => ({ dataProvider: null, loadFredSeries: async () => { throw new Error("resolve must not load bars"); } }),
    });
    for (const session of ["regular", "extended"] as const) {
      const info = await new Promise<Record<string, unknown>>((done, reject) => {
        sessionFeed.feed.resolveSymbol(sessionModel.symbol, done, reject, { session });
      });
      const subsessions = info.subsessions as Array<{ id: string; session: string }>;
      expect(info.subsession_id).toBe(session);
      expect(info.session).toBe(subsessions.find((entry) => entry.id === session)!.session);
    }


    const future = await resolve({
      kind: "security",
      instrument: { symbol: "MGE=F", exchange: "CME" },
      fieldId: "market.ohlcv",
    });
    expect(future.session).toBe("24x7");
    expect(future.subsessions).toBeUndefined();

    const crypto = await resolve({
      kind: "security",
      instrument: { symbol: "BTC-USD", exchange: "CCC" },
      fieldId: "market.ohlcv",
    });
    expect(crypto.session).toBe("24x7");
    expect(crypto.subsessions).toBeUndefined();

    const london = await resolve({
      kind: "security",
      instrument: { symbol: "SHEL", exchange: "LSE" },
      fieldId: "market.ohlcv",
    });
    expect(london.session).toBe("24x7");
    expect(london.subsessions).toBeUndefined();
  });

  test("buckets cached hourly bars and live ticks into the requested four-hour candle", async () => {
    const handle = createStaticLibraryFeed("TEST", "Test");
    const start = Date.parse("2026-10-02T08:00:00Z");
    const bars = Array.from({ length: 4 }, (_, index) => ({
      time: start + index * 3_600_000, open: index + 1, high: index + 3,
      low: index, close: index + 2, volume: 10,
    }));
    handle.setBars(bars);
    const history = await readBars(handle.feed, "TEST", "240", start / 1000, (start + 14_400_000) / 1000, 10);
    expect(history).toEqual([{ time: start, open: 1, high: 6, low: 0, close: 5, volume: 40 }]);
    const ticks: typeof history = [];
    handle.feed.subscribeBars({ ticker: "TEST" }, "240", (bar) => ticks.push(bar), "four-hours", () => {});
    await nextMacrotask();
    expect(ticks).toEqual(history);
    handle.setBars(bars.map((bar, index) => index === 3 ? { ...bar, high: 7, close: 7 } : bar));
    expect(ticks.at(-1)).toEqual({ time: start, open: 1, high: 7, low: 0, close: 7, volume: 40 });
  });

  test("advertises only the selected provider's intervals while retaining daily aggregation", async () => {
    const providerCalls: string[] = [];
    const source: ChartSeriesSource = {
      kind: "security", instrument: { symbol: "TEST", exchange: "LSE" }, fieldId: "market.ohlcv",
    };
    const model = libraryChartFromSpec(singleSpec(source))!;
    const instance = createSpecLibraryFeed({
      getDirectory: () => model.directory,
      getSources: () => ({
        dataProvider: {
          getChartResolutionSupport: async (symbol: string, exchange: string) => {
            providerCalls.push(`${exchange}:${symbol}`);
            return [{ resolution: "1h", maxRange: "3M" }, { resolution: "4h", maxRange: "3M" }];
          },
        } as DataProvider,
        loadFredSeries: async () => { throw new Error("metadata must not load prices"); },
      }),
    });
    const info = await new Promise<Record<string, unknown>>((resolve, reject) => {
      instance.feed.resolveSymbol(model.symbol, resolve, reject);
    });
    expect(providerCalls).toEqual(["LSE:TEST"]);
    expect(info.supported_resolutions).toEqual(["60", "240", "D", "W", "M"]);
    expect(info.intraday_multipliers).toEqual(["60", "240"]);
    expect(info.timezone).toBe("Europe/London");
    const economic = await new Promise<Record<string, unknown>>((resolve, reject) => {
      instance.feed.resolveSymbol("FRED:CPIAUCSL", resolve, reject);
    });
    expect(economic.supported_resolutions).toEqual(["D", "W", "M"]);
    expect(economic.has_intraday).toBe(false);
    expect(economic.timezone).toBe("Etc/UTC");
    expect(providerCalls).toEqual(["LSE:TEST"]);
  });

  test("prediction metadata cache never substitutes a preview load for a requested history window", async () => {
    const source: ChartSeriesSource = { kind: "prediction-market", venue: "kalshi", marketId: "daily-market" };
    const model = libraryChartFromSpec(singleSpec(source))!;
    let loads = 0;
    const start = Date.UTC(2026, 0, 1);
    const instance = createSpecLibraryFeed({
      getDirectory: () => model.directory,
      getSources: () => ({
        dataProvider: null,
        loadFredSeries: async () => { throw new Error("not FRED"); },
        loadUniversalSeries: async (_source, request) => {
          loads += 1;
          return { points: Array.from({ length: 8 }, (_, index) => ({
            date: new Date(start + index * 3_600_000),
            observedAt: new Date(start + index * 3_600_000), value: (request ? 110 : 10) + index,
          })) };
        },
      }),
    });
    const info = await new Promise<Record<string, unknown>>((done, reject) => {
      instance.feed.resolveSymbol(model.symbol, done, reject);
    });
    expect(info.supported_resolutions).toEqual(["60", "240", "D", "W", "M"]);
    const result = await readBars(instance.feed, model.symbol, "240", start / 1000, (start + 8 * 3_600_000) / 1000, 10);
    expect(result.map((bar) => [bar.time, bar.open, bar.close])).toEqual([
      [start, 110, 113], [start + 4 * 3_600_000, 114, 117],
    ]);
    await new Promise<Record<string, unknown>>((done, reject) => {
      instance.feed.resolveSymbol(model.symbol, done, reject);
    });
    expect(loads).toBe(2);
  });

  test("cached symbol capabilities track observed cadence and never infer minutes from annual points", async () => {
    const instance = createStaticLibraryFeed("SERIES", "Series");
    const resolve = () => new Promise<Record<string, unknown>>((done, reject) => {
      instance.feed.resolveSymbol("SERIES", done, reject);
    });
    const bars = (step: number) => Array.from({ length: 5 }, (_, index) => ({
      time: Date.UTC(2026, 0, 1) + index * step, open: 1, high: 1, low: 1, close: 1,
    }));
    instance.setBars(bars(3_600_000));
    expect((await resolve()).supported_resolutions).toEqual(["60", "240", "D", "W", "M"]);
    instance.setBars(bars(365 * 86_400_000));
    expect((await resolve()).supported_resolutions).toEqual(["D", "W", "M"]);
    const resolved = createResolvedSeriesLibraryFeed();
    resolved.setSeries([{ id: "hourly", label: "Hourly", style: "line", points: bars(3_600_000).map((bar) => ({
      date: new Date(bar.time), observedAt: new Date(bar.time), value: bar.close,
    })) }]);
    const info = await new Promise<Record<string, unknown>>((done, reject) => {
      resolved.feed.resolveSymbol(resolved.model().symbol, done, reject);
    });
    expect(info.supported_resolutions).toEqual(["60", "240", "D", "W", "M"]);
  });

  test("keeps the minute and hour resolution a timeframe button asked for", async () => {
    const calls: Array<{ range: string; resolution: string }> = [];
    const source: ChartSeriesSource = {
      kind: "security",
      instrument: { symbol: "HOOD", exchange: "XNAS" },
      fieldId: "market.ohlcv",
    };
    const model = libraryChartFromSpec(singleSpec(source));
    const to = Date.parse("2026-10-02T20:00:00.000Z") / 1000;
    const provider = {
      id: "yahoo",
      name: "yahoo",
      getChartResolutionSupport: () => DEFAULT_CHART_RESOLUTION_SUPPORT,
      getPriceHistory: () => Promise.reject(new Error("range history should not run")),
      getPriceHistoryForResolution: (
        _ticker: string,
        _exchange: string,
        range: string,
        resolution: string,
      ) => {
        calls.push({ range, resolution });
        const end = to * 1000;
        const step = resolution === "1m" ? 60_000 : resolution === "5m" ? 300_000 : 3_600_000;
        const bars: PricePoint[] = [];
        for (let time = end - step * 4; time <= end; time += step) {
          bars.push({ date: new Date(time), open: 1, high: 2, low: 1, close: 1, volume: 1 });
        }
        return Promise.resolve(bars);
      },
    } as DataProvider;
    const feed = createSpecLibraryFeed({
      getDirectory: () => model!.directory,
      getSources: () => ({
        dataProvider: provider,
        loadFredSeries: () => Promise.reject(new Error("fred is not this series")),
        now: new Date("2026-10-02T20:00:00.000Z"),
      }),
    });
    const wideFrom = Date.parse("2020-01-01T00:00:00.000Z") / 1000;
    const minutes = await readBarResult(feed.feed, model!.symbol, "1", wideFrom, to, 300);
    expect(calls).toEqual([{ range: "1D", resolution: "1m" }]);
    expect(minutes.bars.length).toBeGreaterThan(0);
    expect(minutes.meta.noData).toBe(true);

    calls.length = 0;
    const hours = await readBarResult(feed.feed, model!.symbol, "60", wideFrom, to, 300);
    expect(calls).toEqual([{ range: "3M", resolution: "1h" }]);
    expect(hours.bars.length).toBeGreaterThan(0);
    expect(hours.meta.noData).toBe(true);

    calls.length = 0;
    const fiveDays = await readBarResult(feed.feed, model!.symbol, "5", to - 5 * 86_400, to, 300);
    expect(calls).toEqual([{ range: "1W", resolution: "5m" }]);
    expect(fiveDays.bars.length).toBeGreaterThan(0);
    expect(fiveDays.meta.noData).toBe(false);
  });
});

function singleSpec(source: ChartSeriesSource): ChartSpec {
  return {
    version: CHART_SPEC_VERSION,
    viewport: { range: "1M", resolution: "auto" },
    panels: [{ id: "main", height: 1, scale: "linear" }],
    series: [{
      id: "price",
      source,
      style: "line",
      transform: "raw",
      axis: "auto",
      panelId: "main",
      interpolation: "none",
    }],
    studies: [],
  };
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function readBars(
  feed: { getBars: (
    symbolInfo: { ticker?: string },
    resolution: string,
    periodParams: { from: number; to: number; countBack: number },
    onResult: (bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>, meta: { noData?: boolean }) => void,
    onError: (message: string) => void,
  ) => void },
  ticker: string,
  resolution: string,
  from: number,
  to: number,
  countBack: number,
) {
  return new Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>>((done, reject) => {
    feed.getBars({ ticker }, resolution, { from, to, countBack }, (bars) => done(bars), reject);
  });
}

function readBarResult(
  feed: { getBars: (
    symbolInfo: { ticker?: string },
    resolution: string,
    periodParams: { from: number; to: number; countBack: number },
    onResult: (bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>, meta: { noData?: boolean }) => void,
    onError: (message: string) => void,
  ) => void },
  ticker: string,
  resolution: string,
  from: number,
  to: number,
  countBack: number,
) {
  return new Promise<{
    bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
    meta: { noData?: boolean };
  }>((done, reject) => {
    feed.getBars({ ticker }, resolution, { from, to, countBack }, (bars, meta) => done({ bars, meta }), reject);
  });
}

function dayGaps(bars: Array<{ time: number }>): number[] {
  return bars.slice(1).map((bar, index) => (bar.time - bars[index]!.time) / 86_400_000);
}

function weeklyPrices(): PricePoint[] {
  const bars: PricePoint[] = [];
  for (let time = Date.parse("2021-10-04T04:00:00.000Z"); time <= Date.parse("2026-09-28T04:00:00.000Z"); time += 7 * 86_400_000) {
    bars.push({ date: new Date(time), open: 1, high: 2, low: 1, close: 1, volume: 1 });
  }
  return bars;
}

function quarterlyPrices(): PricePoint[] {
  return ["2025-12-01", "2026-03-01", "2026-06-01", "2026-09-01"].map((day) => ({
    date: new Date(`${day}T04:00:00.000Z`),
    open: 1,
    high: 2,
    low: 1,
    close: 1,
    volume: 1,
  }));
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
