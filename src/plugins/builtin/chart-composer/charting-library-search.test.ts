import { expect, test } from "bun:test";
import { createStaticLibraryFeed } from "./charting-library-feed";
import { createSearchableLibraryFeed, libraryInstrument, type LibraryInstrument } from "./charting-library-search";
import type { ChartResolveSources } from "../../../time-series/resolve";
import type { DataProvider } from "../../../types/data-provider";

const nvda = libraryInstrument({ kind: "security", instrument: { symbol: "NVDA", exchange: "NASDAQ" }, fieldId: "market.ohlcv" }, "NVIDIA Corporation", "stock")!;
const msft = libraryInstrument({ kind: "security", instrument: { symbol: "MSFT", exchange: "NASDAQ" }, fieldId: "market.ohlcv" }, "Microsoft Corporation", "stock")!;
const at = new Date("2026-09-01T00:00:00Z");
const sources: ChartResolveSources = {
  dataProvider: {
    getChartResolutionSupport: async () => [{ resolution: "1d", maxRange: "ALL" }],
    getPriceHistoryForResolution: async (symbol: string) => [{ date: at, open: 10, high: 20, low: 10, close: symbol === "NVDA" ? 15 : 18 }],
  } as unknown as DataProvider,
  loadFredSeries: async () => { throw new Error("not FRED"); },
  now: new Date("2026-09-02T00:00:00Z"),
};

test("replacement and comparison search route history by instrument and restore without searching again", async () => {
  const base = createStaticLibraryFeed("KALSHI:TEST", "Original market");
  base.setBars([{ time: at.getTime(), open: 50, high: 50, low: 50, close: 50 }]);
  const saved = new Map<string, LibraryInstrument>();
  const build = () => createSearchableLibraryFeed({ base: base.feed, getSources: () => sources, search: async () => [nvda, msft], read: (ticker) => saved.get(ticker) ?? null, remember: (item) => { saved.set(item.ticker, item); } });
  const handle = build();
  const rows = await new Promise<unknown[]>((resolve) => handle.feed.searchSymbols("", "", "", resolve));
  expect(rows).toHaveLength(3);
  for (const [item, close] of [[nvda, 15], [msft, 18]] as const) {
    const info = await new Promise<Record<string, unknown>>((resolve, reject) => handle.feed.resolveSymbol(item.ticker, resolve, reject));
    expect(info.description).toBe(item.description);
    const bars = await new Promise<unknown[]>((resolve, reject) => handle.feed.getBars(info, "D", { from: at.getTime() / 1000, to: at.getTime() / 1000 + 86400, countBack: 1 }, resolve, reject));
    expect(bars).toMatchObject([{ close }]);
  }
  handle.dispose();
  const restored = build();
  const info = await new Promise<Record<string, unknown>>((resolve, reject) => restored.feed.resolveSymbol(msft.ticker, resolve, reject));
  expect(info.description).toBe("Microsoft Corporation");
  const original = await new Promise<Record<string, unknown>>((resolve, reject) => restored.feed.resolveSymbol("KALSHI:TEST", resolve, reject));
  expect(original.description).toBe("Original market");
  restored.dispose();
});

test("an older search cannot overwrite newer results and failed discovery retains the original series", async () => {
  const base = createStaticLibraryFeed("KALSHI:TEST", "Original market").feed;
  let finishOld: ((items: LibraryInstrument[]) => void) | undefined;
  const handle = createSearchableLibraryFeed({ base, getSources: () => sources, search: (query) => {
    if (query === "old") return new Promise((resolve) => { finishOld = resolve; });
    if (query === "TEST") return Promise.reject(new Error("search offline"));
    return Promise.resolve([msft]);
  }, read: () => null, remember: () => {} });
  let staleCalled = false;
  handle.feed.searchSymbols("old", "", "", () => { staleCalled = true; });
  const rows = await new Promise<unknown[]>((resolve) => handle.feed.searchSymbols("MSFT", "NASDAQ", "stock", resolve));
  finishOld?.([nvda]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(staleCalled).toBe(false);
  expect(rows).toMatchObject([{ ticker: "NASDAQ:MSFT" }]);
  const fallback = await new Promise<unknown[]>((resolve) => handle.feed.searchSymbols("TEST", "", "", resolve));
  expect(fallback).toMatchObject([{ ticker: "KALSHI:TEST" }]);
  handle.dispose();
});
