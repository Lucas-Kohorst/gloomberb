import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import type { PricePoint, TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "./coordinator";
import {
  buildTickerFinancialsKeys,
  copyOnWriteQuoteEntryMap,
  copyOnWriteTickerFinancialsMap,
  mergeTickerFinancials,
  useChartQueries,
  useFxRatesMap,
  useTickerFinancialsMap,
} from "./hooks";
import type { ChartRequest } from "./request-types";
import { buildChartKey, buildQuoteKey, buildSnapshotKey } from "./selectors";
import { createIdleEntry } from "./result-types";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let bumpHarness: (() => void) | null = null;
let replaceChartRequests: ((requests: readonly ChartRequest[]) => void) | null = null;
let latestFxRates: Map<string, number> | null = null;
let latestFinancialsMap: Map<string, TickerFinancials> | null = null;

const readyUsdEntry = {
  phase: "ready" as const,
  data: 1,
  lastGoodData: 1,
  source: "test",
  fetchedAt: 1,
  staleAt: null,
  error: null,
  attempts: [],
};
const readyEurEntry = {
  phase: "ready" as const,
  data: 1.08,
  lastGoodData: 1.08,
  source: "test",
  fetchedAt: 1,
  staleAt: null,
  error: null,
  attempts: [],
};
const sampleFinancials: TickerFinancials = {
  annualStatements: [],
  quarterlyStatements: [],
  priceHistory: [],
  quote: {
    symbol: "SAP",
    price: 250,
    currency: "EUR",
    change: 2,
    changePercent: 0.8,
    lastUpdated: 1,
  },
};
function makeTickerRecord(symbol: string, exchange = "NASDAQ"): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange,
      currency: "USD",
      name: symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function makeFinancials(symbol: string, price: number, quote?: TickerFinancials["quote"]): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    quote: quote ?? {
      symbol,
      price,
      currency: "USD",
      change: 0,
      changePercent: 0,
      lastUpdated: 1,
    },
  };
}

const tickers: TickerRecord[] = [
  makeTickerRecord("SAP", "XETRA"),
];

function HooksHarness() {
  const [tick, setTick] = useState(0);
  bumpHarness = () => setTick((current) => current + 1);

  latestFxRates = useFxRatesMap(["USD", "EUR"]);
  latestFinancialsMap = useTickerFinancialsMap(tickers);

  return <text>{String(tick)}</text>;
}

function FxRatesHarness() {
  latestFxRates = useFxRatesMap(["usd", "EUR", null]);

  return <text>fx</text>;
}

function ChartQueriesHarness({
  initialRequests,
  debounceMs,
  refreshIntervalMs = 0,
}: {
  initialRequests: readonly ChartRequest[];
  debounceMs: number;
  refreshIntervalMs?: number;
}) {
  const [requests, setRequests] = useState<readonly ChartRequest[]>(initialRequests);
  replaceChartRequests = setRequests;
  useChartQueries(requests, { debounceMs, refreshIntervalMs });

  return <text>{String(requests.length)}</text>;
}

function makeChartRequest(bufferRange: ChartRequest["bufferRange"]): ChartRequest {
  return {
    instrument: {
      symbol: "AAPL",
      exchange: "NASDAQ",
    },
    bufferRange,
    granularity: "range",
  };
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  bumpHarness = null;
  replaceChartRequests = null;
  latestFxRates = null;
  latestFinancialsMap = null;
  setSharedMarketDataCoordinator(null);
});

describe("market-data hooks", () => {
  test("preserve derived map instances across unrelated rerenders", async () => {
    const coordinator = {
      subscribe: () => () => {},
      getVersion: () => 1,
      getFxEntry: (currency: string) => (currency === "EUR" ? readyEurEntry : readyUsdEntry),
      loadFxRate: async () => {},
      getTickerFinancialsSync: () => sampleFinancials,
    };
    setSharedMarketDataCoordinator(coordinator as unknown as MarketDataCoordinator);

    testSetup = await testRender(<HooksHarness />, {
      width: 20,
      height: 1,
    });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    const initialFxRates = latestFxRates;
    const initialFinancialsMap = latestFinancialsMap;

    await act(async () => {
      bumpHarness?.();
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestFxRates).toBe(initialFxRates);
    expect(latestFinancialsMap).toBe(initialFinancialsMap);
  });

  test("does not load USD exchange rates from providers", async () => {
    const loadedFxCurrencies: string[] = [];
    const coordinator = {
      subscribe: () => () => {},
      getVersion: () => 1,
      getFxEntry: (currency: string) => (currency === "EUR" ? readyEurEntry : readyUsdEntry),
      loadFxRate: async (currency: string) => {
        loadedFxCurrencies.push(currency);
      },
    };
    setSharedMarketDataCoordinator(coordinator as unknown as MarketDataCoordinator);

    testSetup = await testRender(<FxRatesHarness />, {
      width: 20,
      height: 1,
    });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestFxRates?.get("USD")).toBe(1);
    expect(loadedFxCurrencies).toEqual(["EUR"]);
  });

  test("debounces chart query batches and cancels superseded schedules", async () => {
    const loadedRanges: string[] = [];
    const idleChartEntry = createIdleEntry<PricePoint[]>();
    const coordinator = {
      subscribe: () => () => {},
      getVersion: () => 1,
      getChartEntry: () => idleChartEntry,
      loadChart: async (request: ChartRequest) => {
        loadedRanges.push(request.bufferRange);
        return idleChartEntry;
      },
    };
    setSharedMarketDataCoordinator(coordinator as unknown as MarketDataCoordinator);

    testSetup = await testRender(
      <ChartQueriesHarness initialRequests={[makeChartRequest("1D")]} debounceMs={40} />,
      {
        width: 20,
        height: 1,
      },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    await act(async () => {
      replaceChartRequests?.([makeChartRequest("1W")]);
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      replaceChartRequests?.([makeChartRequest("1M")]);
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      await testSetup!.renderOnce();
    });

    expect(loadedRanges).toEqual(["1M"]);
  });

  test("refreshes chart query batches on an active interval", async () => {
    const calls: Array<{ range: string; forceRefresh: boolean }> = [];
    const idleChartEntry = createIdleEntry<PricePoint[]>();
    const coordinator = {
      subscribe: () => () => {},
      getVersion: () => 1,
      getChartEntry: () => idleChartEntry,
      loadChart: async (request: ChartRequest, options?: { forceRefresh?: boolean }) => {
        calls.push({
          range: request.bufferRange,
          forceRefresh: options?.forceRefresh === true,
        });
        return idleChartEntry;
      },
    };
    setSharedMarketDataCoordinator(coordinator as unknown as MarketDataCoordinator);

    testSetup = await testRender(
      <ChartQueriesHarness
        initialRequests={[makeChartRequest("1D")]}
        debounceMs={0}
        refreshIntervalMs={20}
      />,
      {
        width: 20,
        height: 1,
      },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 45));
      await testSetup!.renderOnce();
    });

    expect(calls[0]).toEqual({ range: "1D", forceRefresh: false });
    expect(calls.some((call) => call.forceRefresh)).toBe(true);
  });

  test("table overlay subscribes to quote keys only and copy-on-writes unchanged symbols", async () => {
    const overlayTickers = [makeTickerRecord("AAPL"), makeTickerRecord("MSFT")];
    const aaplQuote = { symbol: "AAPL", price: 100, currency: "USD", change: 0, changePercent: 0, lastUpdated: 1 };
    const msftQuote = { symbol: "MSFT", price: 200, currency: "USD", change: 0, changePercent: 0, lastUpdated: 1 };
    let aaplFinancials = makeFinancials("AAPL", 100, aaplQuote);
    let msftFinancials = makeFinancials("MSFT", 200, msftQuote);
    const keyVersions = new Map<string, number>();
    const keyListeners = new Map<string, Set<() => void>>();
    const subscribed: string[][] = [];
    const coordinator = {
      subscribeKeys: (keys: readonly string[], listener: () => void) => {
        subscribed.push([...keys]);
        for (const key of keys) {
          if (!keyListeners.has(key)) keyListeners.set(key, new Set());
          keyListeners.get(key)!.add(listener);
        }
        return () => {
          for (const key of keys) keyListeners.get(key)?.delete(listener);
        };
      },
      getKeysVersion: (keys: readonly string[]) => (
        keys.reduce((sum, key) => sum + (keyVersions.get(key) ?? 0), 0)
      ),
      getTickerFinancialsSync: (instrument: { symbol: string }) => (
        instrument.symbol === "AAPL" ? { ...aaplFinancials } : { ...msftFinancials }
      ),
    };
    setSharedMarketDataCoordinator(coordinator as unknown as MarketDataCoordinator);

    function OverlayHarness() {
      latestFinancialsMap = useTickerFinancialsMap(overlayTickers);
      return <text>overlay</text>;
    }

    testSetup = await testRender(<OverlayHarness />, { width: 20, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    const keys = subscribed.at(-1) ?? [];
    expect(keys.length).toBe(2);
    expect(keys.every((key) => key.startsWith("quote:"))).toBe(true);
    expect(keys).toContain(buildQuoteKey({ symbol: "AAPL", exchange: "NASDAQ" }));
    expect(keys).toContain(buildQuoteKey({ symbol: "MSFT", exchange: "NASDAQ" }));
    expect(keys.some((key) => key.startsWith("snapshot:") || key.startsWith("chart:"))).toBe(false);

    const initialMap = latestFinancialsMap;
    const initialAapl = initialMap?.get("AAPL");
    const initialMsft = initialMap?.get("MSFT");
    expect(initialAapl).toBeDefined();
    expect(initialMsft).toBeDefined();

    const aaplChartKey = buildChartKey({
      instrument: { symbol: "AAPL", exchange: "NASDAQ" },
      bufferRange: "5Y",
      granularity: "range",
    });
    const aaplSnapshotKey = buildSnapshotKey({ symbol: "AAPL", exchange: "NASDAQ" });
    keyVersions.set(aaplChartKey, 1);
    keyVersions.set(aaplSnapshotKey, 1);
    await act(async () => {
      for (const listener of keyListeners.get(aaplChartKey) ?? []) listener();
      for (const listener of keyListeners.get(aaplSnapshotKey) ?? []) listener();
      await testSetup!.renderOnce();
    });
    expect(latestFinancialsMap).toBe(initialMap);

    aaplFinancials = makeFinancials("AAPL", 101, { ...aaplQuote, price: 101, lastUpdated: 2 });
    msftFinancials = makeFinancials("MSFT", 200, msftQuote);
    const aaplQuoteKey = buildQuoteKey({ symbol: "AAPL", exchange: "NASDAQ" });
    keyVersions.set(aaplQuoteKey, (keyVersions.get(aaplQuoteKey) ?? 0) + 1);
    await act(async () => {
      for (const listener of keyListeners.get(aaplQuoteKey) ?? []) listener();
      await testSetup!.renderOnce();
    });

    expect(latestFinancialsMap).not.toBe(initialMap);
    expect(latestFinancialsMap?.get("AAPL")).not.toBe(initialAapl);
    expect(latestFinancialsMap?.get("AAPL")?.quote?.price).toBe(101);
    expect(latestFinancialsMap?.get("MSFT")).toBe(initialMsft);
  });
});

describe("mergeTickerFinancials", () => {
  const record = (symbol: string) => ({ metadata: { ticker: symbol } } as TickerRecord);
  const data = (price: number) => ({
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    quote: { symbol: "X", price, currency: "USD", change: 0, changePercent: 0, lastUpdated: 1 },
  } as TickerFinancials);

  test("live market data wins over the cached store", () => {
    const merged = mergeTickerFinancials(
      [record("AAPL")],
      new Map([["AAPL", data(200)]]),
      new Map([["AAPL", data(100)]]),
    );
    expect(merged.get("AAPL")?.quote?.price).toBe(200);
  });

  test("falls back to the cache for tickers with no live data yet", () => {
    const merged = mergeTickerFinancials([record("MSFT")], new Map(), new Map([["MSFT", data(50)]]));
    expect(merged.get("MSFT")?.quote?.price).toBe(50);
  });

  // The whole point of the change: consumers that iterate the result must not
  // walk symbols the caller never asked about.
  test("excludes cached symbols outside the requested tickers", () => {
    const merged = mergeTickerFinancials(
      [record("AAPL")],
      new Map(),
      new Map([["AAPL", data(1)], ["UNRELATED", data(2)]]),
    );
    expect([...merged.keys()]).toEqual(["AAPL"]);
  });
});

describe("copyOnWriteQuoteEntryMap", () => {
  test("reuses the previous Map when quote entries are unchanged", () => {
    const entry = createIdleEntry();
    const previous = new Map([["quote:AAPL", entry]]);
    expect(copyOnWriteQuoteEntryMap(previous, new Map([["quote:AAPL", entry]]))).toBe(previous);

    const nextEntry = { ...entry, fetchedAt: 2 };
    const next = copyOnWriteQuoteEntryMap(previous, new Map([["quote:AAPL", nextEntry]]));
    expect(next).not.toBe(previous);
    expect(next.get("quote:AAPL")).toBe(nextEntry);
  });
});

describe("copyOnWriteTickerFinancialsMap", () => {
  test("reuses unchanged TickerFinancials identities and the previous Map when quotes are unchanged", () => {
    const aaplQuote = { symbol: "AAPL", price: 100, currency: "USD", change: 0, changePercent: 0, lastUpdated: 1 };
    const msftQuote = { symbol: "MSFT", price: 200, currency: "USD", change: 0, changePercent: 0, lastUpdated: 1 };
    const aapl = makeFinancials("AAPL", 100, aaplQuote);
    const msft = makeFinancials("MSFT", 200, msftQuote);
    const previous = new Map([["AAPL", aapl], ["MSFT", msft]]);

    const unchanged = copyOnWriteTickerFinancialsMap(
      previous,
      new Map([
        ["AAPL", makeFinancials("AAPL", 100, aaplQuote)],
        ["MSFT", makeFinancials("MSFT", 200, msftQuote)],
      ]),
    );
    expect(unchanged).toBe(previous);
    expect(unchanged.get("AAPL")).toBe(aapl);
    expect(unchanged.get("MSFT")).toBe(msft);

    const nextAapl = makeFinancials("AAPL", 101, { ...aaplQuote, price: 101, lastUpdated: 2 });
    const next = copyOnWriteTickerFinancialsMap(
      previous,
      new Map([
        ["AAPL", nextAapl],
        ["MSFT", makeFinancials("MSFT", 200, msftQuote)],
      ]),
    );
    expect(next).not.toBe(previous);
    expect(next.get("AAPL")).toBe(nextAapl);
    expect(next.get("MSFT")).toBe(msft);
  });
});

describe("buildTickerFinancialsKeys", () => {
  test("subscribes to quote keys only", () => {
    const keys = buildTickerFinancialsKeys([makeTickerRecord("AAPL"), makeTickerRecord("MSFT")]);
    expect(keys).toEqual([
      buildQuoteKey({ symbol: "AAPL", exchange: "NASDAQ" }),
      buildQuoteKey({ symbol: "MSFT", exchange: "NASDAQ" }),
    ]);
    expect(keys.some((key) => key.startsWith("snapshot:") || key.startsWith("chart:"))).toBe(false);
  });
});
