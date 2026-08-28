import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DataProvider } from "../../types/data-provider";
import type { InstrumentSearchResult } from "../../types/instrument";
import type { TickerRecord } from "../../types/ticker";
import { createTestDataProvider } from "../../test-support/data-provider";
import { setUsListingsUniverseForTests } from "../../sources/us-listings/client";
import {
  buildTickerSearchCandidates,
  findExactTickerSearchMatch,
  normalizeTickerInput,
  parseTickerListingQuery,
  rankTickerSearchItems,
  resolveTickerSearch,
  searchTickerCandidates,
  upsertTickerFromSearchResult,
} from "./index";

function makeTicker(
  symbol: string,
  name = symbol,
  overrides: Partial<TickerRecord["metadata"]> = {},
): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

function makeSearchResult(
  symbol: string,
  name = symbol,
  overrides: Partial<InstrumentSearchResult> = {},
): InstrumentSearchResult {
  return {
    providerId: "test",
    symbol,
    name,
    exchange: "NASDAQ",
    type: "EQUITY",
    ...overrides,
  };
}

function makeDataProvider(results: InstrumentSearchResult[]): DataProvider {
  return createTestDataProvider({
    id: "test",
    search: async () => results,
  });
}

describe("ticker-search utilities", () => {
  beforeEach(() => {
    setUsListingsUniverseForTests(null);
  });

  afterEach(() => {
    setUsListingsUniverseForTests(undefined);
  });

  test("normalizes explicit and focused ticker inputs", () => {
    expect(normalizeTickerInput("AAPL", undefined)).toBe("AAPL");
    expect(normalizeTickerInput("AAPL", " msft ")).toBe("MSFT");
    expect(normalizeTickerInput(null, undefined)).toBeNull();
  });

  test("finds exact provider matches for direct ticker resolution", async () => {
    const tickers = new Map<string, TickerRecord>([["AAPL", makeTicker("AAPL", "Apple")]]);
    const resolved = await resolveTickerSearch({
      query: "MSFT",
      activeTicker: null,
      tickers,
      dataProvider: makeDataProvider([
        makeSearchResult("MSFT", "Microsoft"),
        makeSearchResult("MSFTW", "Microsoft Warrants"),
      ]),
    });

    expect(resolved).toMatchObject({
      kind: "provider",
      symbol: "MSFT",
    });
  });

  test("resolves COIN to Coinbase, not a CoinGecko name hit or IDX listing", async () => {
    const resolved = await resolveTickerSearch({
      query: "COIN",
      activeTicker: null,
      tickers: new Map(),
      dataProvider: makeDataProvider([
        makeSearchResult("BTC-USD", "Bitcoin", { exchange: "CCC", type: "CRYPTO" }),
        makeSearchResult("COIN", "PT Indokripto Koin Semesta Tbk", { exchange: "Jakarta", type: "EQUITY" }),
        makeSearchResult("COIN", "Coinbase Global, Inc.", { exchange: "NASDAQ", type: "EQUITY" }),
      ]),
    });

    expect(resolved).toMatchObject({
      kind: "provider",
      symbol: "COIN",
    });
    expect(resolved?.kind === "provider" ? resolved.result.name : null).toBe("Coinbase Global, Inc.");
    expect(resolved?.kind === "provider" ? resolved.result.exchange : null).toBe("NASDAQ");
  });

  test("combines local and provider candidates without duplicate saved symbols", async () => {
    const tickers = new Map<string, TickerRecord>([["AAPL", makeTicker("AAPL", "Apple")]]);
    const results = await searchTickerCandidates({
      query: "appl",
      tickers,
      dataProvider: makeDataProvider([
        makeSearchResult("AAPL", "Apple Inc"),
        makeSearchResult("APP", "AppLovin"),
      ]),
    });

    expect(results.map((item) => item.id)).toEqual(["goto:AAPL", "search:APP:NASDAQ:TEST"]);
    expect(findExactTickerSearchMatch(results, "AAPL")?.id).toBe("goto:AAPL");
  });

  test("uses provider metadata to keep stale saved tickers intuitive in search results", async () => {
    const tickers = new Map<string, TickerRecord>([["AAPL", makeTicker("AAPL", "AAPL")]]);
    const results = await searchTickerCandidates({
      query: "apple",
      tickers,
      dataProvider: makeDataProvider([
        makeSearchResult("AAPL", "Apple Inc"),
        makeSearchResult("APLE", "Apple Hospitality REIT, Inc."),
      ]),
    });

    expect(results.map((item) => item.id)).toEqual(["goto:AAPL", "search:APLE:NASDAQ:TEST"]);
    expect(results[0]).toMatchObject({
      id: "goto:AAPL",
      detail: "Apple Inc",
      category: "Saved",
    });
    expect(findExactTickerSearchMatch(results, "AAPL")?.id).toBe("goto:AAPL");
  });

  test("enriches duplicate provider symbols from the saved listing's exchange", () => {
    const results = buildTickerSearchCandidates({
      query: "Apple NASDAQ",
      tickers: new Map<string, TickerRecord>([
        ["APC", makeTicker("APC", "Apple Inc.", { exchange: "XETRA", assetCategory: "STK" })],
        ["AAPL", makeTicker("AAPL", "Apple Inc.", { exchange: "NASDAQ", assetCategory: "STK" })],
      ]),
      providerResults: [
        makeSearchResult("APC", "Apple Inc.", { exchange: "XETRA" }),
        makeSearchResult("AAPL", "Apple Inc. CEDEAR", {
          exchange: "BYMA",
          primaryExchange: "BYMA",
          currency: "ARS",
        }),
        makeSearchResult("AAPL", "Apple Inc.", {
          exchange: "SMART",
          brokerContract: {
            brokerId: "test",
            symbol: "AAPL",
            exchange: "NASDAQ",
          },
        }),
      ],
    });

    expect(results[0]).toMatchObject({
      id: "goto:AAPL",
      right: "NASDAQ",
      exchangeLabel: "NASDAQ",
    });
  });

  test("does not apply a conflicting provider primary exchange to a saved listing", () => {
    const results = buildTickerSearchCandidates({
      query: "Apple BUE",
      tickers: new Map<string, TickerRecord>([[
        "AAPL",
        makeTicker("AAPL", "Apple Inc.", { exchange: "NASDAQ", assetCategory: "STK" }),
      ]]),
      providerResults: [
        makeSearchResult("AAPL", "Apple Inc.", {
          exchange: "SMART",
          primaryExchange: "BUE",
        }),
        makeSearchResult("AAPLC.BA", "Apple Inc.", { exchange: "BUE" }),
      ],
    });

    expect(results[0]?.symbol).toBe("AAPLC.BA");
    expect(results.find((item) => item.symbol === "AAPL")?.primaryExchangeLabel).toBeUndefined();
  });

  test("uses provider ordering to prefer the canonical saved listing for company-name queries", () => {
    const tickers = new Map<string, TickerRecord>([
      ["APC", makeTicker("APC", "Apple Inc.", {
        exchange: "XETRA",
        currency: "EUR",
        assetCategory: "STK",
      })],
      ["AAPL", makeTicker("AAPL", "Apple Inc.", {
        exchange: "NASDAQ",
        currency: "USD",
        assetCategory: "STK",
      })],
    ]);

    const results = buildTickerSearchCandidates({
      query: "Apple",
      tickers,
      providerResults: [
        makeSearchResult("AAPL", "Apple Inc.", {
          exchange: "NASDAQ",
          primaryExchange: "NASDAQ",
          currency: "USD",
        }),
        makeSearchResult("APC", "Apple Inc.", {
          exchange: "XETRA",
          primaryExchange: "XETRA",
          currency: "EUR",
        }),
      ],
    });

    expect(results.slice(0, 2).map((item) => item.id)).toEqual([
      "goto:AAPL",
      "goto:APC",
    ]);
    expect(results.slice(0, 2).map((item) => item.category)).toEqual([
      "Saved",
      "Saved",
    ]);
  });

  test("keeps explicit symbol, exchange, and asset-class intent ahead of provider ordering", () => {
    const tickers = new Map<string, TickerRecord>([
      ["APC", makeTicker("APC", "Apple Inc.", {
        exchange: "XETRA",
        currency: "EUR",
        assetCategory: "STK",
      })],
      ["AAPL", makeTicker("AAPL", "Apple Inc.", {
        exchange: "NASDAQ",
        currency: "USD",
        assetCategory: "STK",
      })],
    ]);
    const providerResults = [
      makeSearchResult("AAPL", "Apple Inc.", { exchange: "NASDAQ" }),
      makeSearchResult("APC", "Apple Inc.", { exchange: "XETRA", currency: "EUR" }),
      makeSearchResult("APLY", "Yield Strategy Linked to Apple ETF", { exchange: "NYSE Arca", type: "ETF" }),
      makeSearchResult("APP", "AppLovin Corporation", { exchange: "NASDAQ" }),
    ];
    const firstSymbolFor = (query: string) => buildTickerSearchCandidates({
      query,
      tickers,
      providerResults,
    })[0]?.symbol;

    expect(firstSymbolFor("APC")).toBe("APC");
    expect(firstSymbolFor("APP")).toBe("APP");
    expect(firstSymbolFor("Apple XETRA")).toBe("APC");
    expect(firstSymbolFor("Apple NASDAQ")).toBe("AAPL");
    expect(firstSymbolFor("Apple ETF")).toBe("APLY");
  });

  test("uses provider ordering without assuming the canonical listing is on a US exchange", () => {
    const results = buildTickerSearchCandidates({
      query: "Toyota",
      tickers: new Map<string, TickerRecord>([[
        "TM",
        makeTicker("TM", "Toyota Motor Corporation", {
          exchange: "NYSE",
          currency: "USD",
          assetCategory: "STK",
        }),
      ]]),
      providerResults: [
        makeSearchResult("7203", "Toyota Motor Corp", {
          exchange: "Tokyo Stock Exchange",
          primaryExchange: "Tokyo Stock Exchange",
          currency: "JPY",
        }),
        makeSearchResult("TM", "Toyota Motor Corporation", {
          exchange: "NYSE",
          primaryExchange: "NYSE",
          currency: "USD",
        }),
        makeSearchResult("TOYOTA80.BK", "TOYOTA80 DR", {
          exchange: "SET",
          currency: "THB",
        }),
      ],
    });

    expect(results.slice(0, 2).map((item) => [item.symbol, item.category])).toEqual([
      ["7203", "Primary Listing"],
      ["TM", "Saved"],
    ]);
  });

  test("does not let provider order or an accidental symbol prefix overwhelm a closer company match", () => {
    const results = buildTickerSearchCandidates({
      query: "Apple",
      tickers: new Map<string, TickerRecord>(),
      providerResults: [
        makeSearchResult("APLE", "Apple Hospitality REIT, Inc.", { exchange: "NYSE" }),
        makeSearchResult("AAPL", "Apple Inc.", { exchange: "NASDAQ" }),
        makeSearchResult("APPLE80.BK", "APPLE80 DR", { exchange: "SET", currency: "THB" }),
      ],
    });

    expect(results[0]?.symbol).toBe("AAPL");
    expect(results.some((item) => item.symbol === "APPLE80.BK")).toBe(true);
  });

  test("normalizes legal suffixes in literal company-name queries", () => {
    const cases = [
      {
        query: "Apple Inc",
        canonical: makeSearchResult("AAPL", "Apple Inc.", { exchange: "NASDAQ" }),
        alternate: makeSearchResult("AAPL-ADR", "Apple Inc. ADR", { exchange: "OTC" }),
      },
      {
        query: "Toyota Motor Corporation",
        canonical: makeSearchResult("TM", "Toyota Motor Corporation", { exchange: "NYSE" }),
        alternate: makeSearchResult("TM-ADR", "Toyota Motor Corporation ADR", { exchange: "OTC" }),
      },
    ];

    for (const { query, canonical, alternate } of cases) {
      const results = buildTickerSearchCandidates({
        query,
        tickers: new Map<string, TickerRecord>(),
        providerResults: [alternate, canonical],
      });

      expect(results[0]?.symbol).toBe(canonical.symbol);
    }
  });

  test("keeps same-issuer provider ordering transitive across ambiguous company matches", () => {
    const candidates = [
      {
        id: "big-apple-primary",
        label: "ZZZ",
        symbol: "ZZZ",
        detail: "Big Apple",
        right: "NYSE",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 1,
      },
      {
        id: "big-apple-alternate",
        label: "APPLEB",
        symbol: "APPLEB",
        detail: "Big Apple",
        right: "NASDAQ",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 2,
      },
      {
        id: "unrelated-apple",
        label: "XAPL",
        symbol: "XAPL",
        detail: "X Apple",
        right: "NYSE",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 0,
      },
    ];

    const expected = ["ZZZ", "APPLEB", "XAPL"];
    expect(rankTickerSearchItems(candidates, "Apple").map((item) => item.symbol)).toEqual(expected);
    expect(rankTickerSearchItems([...candidates].reverse(), "Apple").map((item) => item.symbol)).toEqual(expected);
  });

  test("normalizes punctuated legal suffixes before applying same-issuer provider order", () => {
    const results = buildTickerSearchCandidates({
      query: "Acme",
      tickers: new Map<string, TickerRecord>(),
      providerResults: [
        makeSearchResult("AMS.MC", "Acme S.A.", { exchange: "BME" }),
        makeSearchResult("ACM", "Acme SA", { exchange: "NYSE" }),
      ],
    });

    expect(results.slice(0, 2).map((item) => item.symbol)).toEqual(["AMS.MC", "ACM"]);
  });

  test("keeps saved funds in the saved category", () => {
    const results = buildTickerSearchCandidates({
      query: "Vanguard",
      tickers: new Map<string, TickerRecord>([[
        "VTI",
        makeTicker("VTI", "Vanguard Total Stock Market ETF", {
          exchange: "NYSE Arca",
          assetCategory: "ETF",
        }),
      ]]),
      providerResults: [],
    });

    expect(results[0]).toMatchObject({ symbol: "VTI", category: "Saved" });
  });

  test("preserves exchange-qualified symbols and groups provider listings intuitively", () => {
    const results = buildTickerSearchCandidates({
      query: "apple",
      tickers: new Map<string, TickerRecord>(),
      providerResults: [
        makeSearchResult("AAPL", "Apple Inc"),
        { ...makeSearchResult("AAPL.BA", "Apple Inc"), exchange: "Buenos Aires" },
        { ...makeSearchResult("APLY.NE", "Apple Yield Shares Purpose ETF"), exchange: "NEO", type: "ETF" },
      ],
      localLimit: 6,
      totalLimit: 8,
    });

    expect(results.map((item) => [item.label, item.category])).toEqual([
      ["AAPL", "Primary Listing"],
      ["AAPL.BA", "Other Listings"],
      ["APLY.NE", "Funds & Derivatives"],
    ]);
  });

  test("finds exact symbol aliases for dotted share classes", () => {
    const match = findExactTickerSearchMatch([
      {
        id: "search:BRK.B",
        label: "BRK.B",
        detail: "Berkshire Hathaway Inc. Class B",
        kind: "search",
        category: "Primary Listing",
        searchAliases: ["BRK.B", "BRK B", "BRKB"],
      },
    ], "brkb");

    expect(match?.id).toBe("search:BRK.B");
  });

  test("expands compact share-class queries when searching providers", async () => {
    const queries: string[] = [];
    const expandedResults = await searchTickerCandidates({
      query: "brkb",
      tickers: new Map<string, TickerRecord>(),
      dataProvider: createTestDataProvider({
        id: "test",
        search: async (query) => {
          queries.push(query);
          return query.toLowerCase() === "brk-b"
            ? [{ providerId: "test", symbol: "BRK-B", name: "Berkshire Hathaway Inc. Class B", exchange: "NYSE", type: "EQUITY" }]
            : [];
        },
      }),
      totalLimit: 5,
    });

    expect(queries).toContain("BRK-B");
    expect(expandedResults[0]).toMatchObject({
      label: "BRK-B",
      category: "Primary Listing",
    });
  });

  test("tries canonical symbol aliases before raw lowercase provider searches", async () => {
    const queries: string[] = [];
    const results = await searchTickerCandidates({
      query: "nvda",
      tickers: new Map<string, TickerRecord>(),
      dataProvider: createTestDataProvider({
        id: "test",
        search: async (query) => {
          queries.push(query);
          return query === "NVDA"
            ? [makeSearchResult("NVDA", "NVIDIA Corporation")]
            : [{ ...makeSearchResult("NVD", "GraniteShares 2x Short NVDA Daily ETF"), exchange: "NYSEArca", type: "ETF" }];
        },
      }),
      totalLimit: 5,
      includeOptionContracts: false,
    });

    expect(queries[0]).toBe("NVDA");
    expect(results[0]).toMatchObject({
      label: "NVDA",
      category: "Primary Listing",
    });
  });

  test("upserts ticker records from provider search results", async () => {
    const saved: TickerRecord[] = [];
    const repository = {
      loadTicker: async () => null,
      createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
      saveTicker: async (ticker: TickerRecord) => {
        saved.push(ticker);
      },
    };

    const { ticker, created } = await upsertTickerFromSearchResult(repository as any, {
      providerId: "test",
      symbol: "NVDA",
      name: "NVIDIA",
      exchange: "NASDAQ",
      type: "EQUITY",
      currency: "USD",
    });

    expect(created).toBe(true);
    expect(ticker.metadata.ticker).toBe("NVDA");
    expect(saved).toHaveLength(0);
  });

  test("canonicalizes slash crypto search results onto BTC-USD / CCC", async () => {
    const created: TickerRecord[] = [];
    const repository = {
      loadTicker: async () => null,
      createTicker: async (metadata: TickerRecord["metadata"]) => {
        const ticker = { metadata };
        created.push(ticker);
        return ticker;
      },
      saveTicker: async () => {},
    };

    const { ticker } = await upsertTickerFromSearchResult(repository as any, {
      providerId: "yahoo",
      symbol: "SOL/USD",
      name: "Solana US Dollar",
      exchange: "CCY",
      type: "CURRENCY",
    });

    expect(ticker.metadata.ticker).toBe("SOL-USD");
    expect(ticker.metadata.exchange).toBe("CCC");
    expect(ticker.metadata.assetCategory).toBe("CRYPTO");
    expect(created).toHaveLength(1);
  });

  test("refreshes low-quality saved metadata when opening a provider-backed result", async () => {
    const existing = makeTicker("AAPL", "AAPL");
    const saved: TickerRecord[] = [];
    const repository = {
      loadTicker: async () => existing,
      createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
      saveTicker: async (ticker: TickerRecord) => {
        saved.push(ticker);
      },
    };

    const { ticker, created } = await upsertTickerFromSearchResult(repository as any, {
      providerId: "test",
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NASDAQ",
      type: "EQUITY",
      currency: "USD",
    });

    expect(created).toBe(false);
    expect(ticker.metadata.name).toBe("Apple Inc.");
    expect(saved).toHaveLength(1);
  });

  test("replaces a saved listing when search selects a different exchange", async () => {
    const existing = makeTicker("AAPL", "Apple Inc.");
    existing.metadata.exchange = "NASDAQ";
    existing.metadata.currency = "USD";
    const saved: TickerRecord[] = [];
    const repository = {
      loadTicker: async () => existing,
      createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
      saveTicker: async (ticker: TickerRecord) => {
        saved.push(ticker);
      },
    };

    const { ticker } = await upsertTickerFromSearchResult(repository as any, {
      providerId: "test",
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "BYMA",
      type: "EQUITY",
      currency: "ARS",
    });

    expect(ticker.metadata.exchange).toBe("BYMA");
    expect(ticker.metadata.currency).toBe("ARS");
    expect(saved).toHaveLength(1);
  });

  test("parses exchange-qualified and Bloomberg listing queries", () => {
    expect(parseTickerListingQuery("NYSE:BLK")).toEqual({
      symbol: "BLK",
      textQuery: "BLK",
      exchangeHints: ["NYSE"],
    });
    expect(parseTickerListingQuery("BLK:NYSE")).toEqual({
      symbol: "BLK",
      textQuery: "BLK",
      exchangeHints: ["NYSE"],
    });
    expect(parseTickerListingQuery("BLK US")).toEqual({
      symbol: "BLK",
      textQuery: "BLK",
      exchangeHints: ["US"],
    });
    expect(parseTickerListingQuery("BLK NYSE")).toEqual({
      symbol: "BLK",
      textQuery: "BLK",
      exchangeHints: ["NYSE"],
    });
    expect(parseTickerListingQuery("NASDAQ:GLXY")).toEqual({
      symbol: "GLXY",
      textQuery: "GLXY",
      exchangeHints: ["NASDAQ"],
    });
    expect(parseTickerListingQuery("TSX:GLXY")).toEqual({
      symbol: "GLXY",
      textQuery: "GLXY",
      exchangeHints: ["TSX"],
    });
    expect(parseTickerListingQuery("UBER")).toEqual({
      symbol: "UBER",
      textQuery: "UBER",
      exchangeHints: [],
    });
  });

  test("ranks the US primary listing ahead of TSX for a bare dual-listed symbol", () => {
    const first = rankTickerSearchItems([
      {
        id: "search:UBER:TSX",
        label: "UBER",
        symbol: "UBER",
        detail: "Uber Technologies, Inc.",
        right: "Toronto",
        exchangeLabel: "Toronto",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 0,
      },
      {
        id: "search:UBER:NYSE",
        label: "UBER",
        symbol: "UBER",
        detail: "Uber Technologies, Inc.",
        right: "NYQ",
        exchangeLabel: "NYQ",
        primaryExchangeLabel: "NYSE",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 1,
      },
    ], "UBER");

    expect(first[0]).toMatchObject({ id: "search:UBER:NYSE", exchangeLabel: "NYQ" });
  });

  test("pins NYSE:BLK, BLK US, and TSX:GLXY to the requested venue", () => {
    const blkListings = [
      {
        id: "search:BLK:TSX",
        label: "BLK",
        symbol: "BLK",
        detail: "BlackRock, Inc.",
        right: "TSX",
        exchangeLabel: "TSX",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 0,
      },
      {
        id: "search:BLK:NYSE",
        label: "BLK",
        symbol: "BLK",
        detail: "BlackRock, Inc.",
        right: "NYSE",
        exchangeLabel: "NYSE",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 1,
      },
    ];
    const glxyListings = [
      {
        id: "search:GLXY:TSX",
        label: "GLXY.TO",
        symbol: "GLXY.TO",
        detail: "Galaxy Digital Holdings",
        right: "Toronto",
        exchangeLabel: "Toronto",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 0,
      },
      {
        id: "search:GLXY:NASDAQ",
        label: "GLXY",
        symbol: "GLXY",
        detail: "Galaxy Digital Inc.",
        right: "NasdaqGS",
        exchangeLabel: "NasdaqGS",
        category: "Other Listings",
        kind: "search" as const,
        instrumentClass: "equity" as const,
        providerRank: 1,
      },
    ];

    expect(rankTickerSearchItems(blkListings, "NYSE:BLK")[0]?.id).toBe("search:BLK:NYSE");
    expect(rankTickerSearchItems(blkListings, "BLK NYSE")[0]?.id).toBe("search:BLK:NYSE");
    expect(rankTickerSearchItems(blkListings, "BLK US")[0]?.id).toBe("search:BLK:NYSE");
    expect(rankTickerSearchItems(glxyListings, "NASDAQ:GLXY")[0]?.id).toBe("search:GLXY:NASDAQ");
    expect(rankTickerSearchItems(glxyListings, "TSX:GLXY")[0]?.id).toBe("search:GLXY:TSX");
    expect(rankTickerSearchItems(glxyListings, "GLXY")[0]?.id).toBe("search:GLXY:NASDAQ");
  });

  test("resolves bare and exchange-qualified dual listings onto the intended venue", async () => {
    const provider = makeDataProvider([
      makeSearchResult("UBER", "Uber Technologies, Inc.", { exchange: "Toronto" }),
      makeSearchResult("UBER", "Uber Technologies, Inc.", { exchange: "NYSE" }),
      makeSearchResult("BLK", "BlackRock, Inc.", { exchange: "TSX" }),
      makeSearchResult("BLK", "BlackRock, Inc.", { exchange: "NYSE" }),
      makeSearchResult("GLXY.TO", "Galaxy Digital Holdings", { exchange: "Toronto" }),
      makeSearchResult("GLXY", "Galaxy Digital Inc.", { exchange: "NasdaqGS" }),
    ]);

    const resolve = (query: string) => resolveTickerSearch({
      query,
      activeTicker: null,
      tickers: new Map(),
      dataProvider: provider,
    });

    await expect(resolve("UBER")).resolves.toMatchObject({
      kind: "provider",
      symbol: "UBER",
      result: { exchange: "NYSE" },
    });
    await expect(resolve("NYSE:BLK")).resolves.toMatchObject({
      kind: "provider",
      symbol: "BLK",
      result: { exchange: "NYSE" },
    });
    await expect(resolve("BLK US")).resolves.toMatchObject({
      kind: "provider",
      symbol: "BLK",
      result: { exchange: "NYSE" },
    });
    await expect(resolve("TSX:GLXY")).resolves.toMatchObject({
      kind: "provider",
      symbol: "GLXY.TO",
      result: { exchange: "Toronto" },
    });
  });

  test("resolves listed names Yahoo typeahead never returned", async () => {
    setUsListingsUniverseForTests({
      asOf: "2026-08-20T00:00:00.000Z",
      ttlSeconds: 43200,
      sources: [],
      securities: [
        {
          symbol: "ZUMZ",
          name: "Zumiez Inc. - Common Stock",
          exchange: "NASDAQ",
          type: "EQUITY",
          source: "nasdaqlisted",
        },
      ],
    });

    const results = await searchTickerCandidates({
      query: "zumiez",
      tickers: new Map(),
      dataProvider: makeDataProvider([
        makeSearchResult("AAPL", "Apple Inc"),
      ]),
    });

    expect(results.some((item) => item.symbol === "ZUMZ")).toBe(true);
    expect(results.find((item) => item.symbol === "ZUMZ")?.result?.providerId).toBe("us-listings");

    const resolved = await resolveTickerSearch({
      query: "ZUMZ",
      activeTicker: null,
      tickers: new Map(),
      dataProvider: makeDataProvider([]),
    });
    expect(resolved).toMatchObject({ kind: "provider", symbol: "ZUMZ" });
  });
});
