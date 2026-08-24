import { describe, expect, test } from "bun:test";
import {
  applyFilters,
  parseFilterArgs,
  activeFilterCount,
} from "./filters";
import { extractScreenerResult, DEFAULT_UNIVERSE } from "./client";
import type { ScreenerResult } from "./types";
import type { TickerFinancials } from "../../../types/financials";
import {
  buildScreenerColumns,
  filterScreenerRows,
  nextSortPreference,
  sortRows,
  DEFAULT_SORT_PREFERENCE,
  type ScreenerSortPreference,
} from "./model";

// ── Test fixtures ───────────────────────────────────────────────────

function makeResult(overrides: Partial<ScreenerResult> = {}): ScreenerResult {
  return {
    symbol: "TEST",
    name: "Test Corp",
    exchange: "NASDAQ",
    sector: "Technology",
    price: 100,
    marketCap: 1e10,
    peRatio: 15,
    pbRatio: 2.5,
    debtToEquity: 0.3,
    revenueGrowth: 0.1,
    grossMargin: 0.4,
    netMargin: 0.12,
    dividendYield: 0.02,
    currency: "USD",
    ...overrides,
  };
}

function makeFinancials(overrides: Partial<TickerFinancials> = {}): TickerFinancials {
  return {
    quote: {
      symbol: "AAPL",
      price: 185,
      currency: "USD",
      change: 1,
      changePercent: 0.5,
      lastUpdated: Date.now(),
      marketCap: 2.9e12,
      name: "Apple Inc.",
      listingExchangeName: "NasdaqGS",
    },
    fundamentals: {
      trailingPE: 28.5,
      dividendYield: 0.005,
      sharesOutstanding: 15_000_000_000,
    },
    profile: {
      sector: "Technology",
      industry: "Consumer Electronics",
    },
    annualStatements: [
      {
        date: "2024-01-01",
        totalRevenue: 383_000_000_000,
        grossProfit: 169_000_000_000,
        netIncome: 97_000_000_000,
        totalDebt: 100_000_000_000,
        commonStockEquity: 62_000_000_000,
        dilutedShares: 15_000_000_000,
      },
      {
        date: "2023-01-01",
        totalRevenue: 383_285_000_000,
      },
    ],
    quarterlyStatements: [],
    priceHistory: [],
    ...overrides,
  };
}

const SAMPLE_RESULTS: ScreenerResult[] = [
  makeResult({ symbol: "AAPL", name: "Apple Inc.", sector: "Technology", marketCap: 2.9e12, peRatio: 28.5, dividendYield: 0.005 }),
  makeResult({ symbol: "MSFT", sector: "Technology", marketCap: 3.1e12, peRatio: 35, dividendYield: 0.007 }),
  makeResult({ symbol: "XOM", name: "Exxon Mobil", sector: "Energy", marketCap: 4.5e11, peRatio: 12, pbRatio: 1.8, debtToEquity: 0.2, dividendYield: 0.035 }),
  makeResult({ symbol: "TSLA", name: "Tesla", sector: "Consumer Cyclical", marketCap: 8e11, peRatio: 60, pbRatio: 10, debtToEquity: 0.15, dividendYield: null, revenueGrowth: 0.25 }),
];

// ── Filter parsing ──────────────────────────────────────────────────

describe("parseFilterArgs", () => {
  test("parses P/E range filter", () => {
    const filters = parseFilterArgs("pe<20");
    expect(filters.peRatio.min).toBeNull();
    expect(filters.peRatio.max).toBe(20);
  });

  test("parses market cap with B suffix", () => {
    const filters = parseFilterArgs("mcap>100B");
    expect(filters.marketCap.min).toBe(100e9);
    expect(filters.marketCap.max).toBeNull();
  });

  test("parses market cap with T suffix", () => {
    const filters = parseFilterArgs("mcap>1T");
    expect(filters.marketCap.min).toBe(1e12);
    expect(filters.marketCap.max).toBeNull();
  });

  test("parses dividend yield as percentage", () => {
    const filters = parseFilterArgs("div>2%");
    expect(filters.dividendYield.min).toBeCloseTo(0.02, 6);
    expect(filters.dividendYield.max).toBeNull();
  });

  test("parses dividend yield without % sign", () => {
    const filters = parseFilterArgs("div>2");
    expect(filters.dividendYield.min).toBeCloseTo(0.02, 6);
  });

  test("parses revenue growth as percentage", () => {
    const filters = parseFilterArgs("growth>10%");
    expect(filters.revenueGrowth.min).toBeCloseTo(0.1, 6);
  });

  test("parses bare sector keyword", () => {
    const filters = parseFilterArgs("tech");
    expect(filters.sector).toBe("tech");
  });

  test("parses sector=tech syntax", () => {
    const filters = parseFilterArgs("sector=healthcare");
    expect(filters.sector).toBe("healthcare");
  });

  test("parses exchange filter", () => {
    const filters = parseFilterArgs("exch=NASDAQ");
    expect(filters.exchange).toBe("NASDAQ");
  });

  test("parses margin kind switch", () => {
    const filters = parseFilterArgs("mk=gross");
    expect(filters.marginKind).toBe("gross");
  });

  test("parses multiple filters at once", () => {
    const filters = parseFilterArgs("tech pe<20 mcap>100B div>1%");
    expect(filters.sector).toBe("tech");
    expect(filters.peRatio.max).toBe(20);
    expect(filters.marketCap.min).toBe(100e9);
    expect(filters.dividendYield.min).toBeCloseTo(0.01, 6);
  });

  test("returns default filters for empty input", () => {
    const filters = parseFilterArgs("");
    expect(filters.sector).toBeNull();
    expect(filters.peRatio.min).toBeNull();
    expect(filters.peRatio.max).toBeNull();
  });

  test("ignores unparseable tokens", () => {
    const filters = parseFilterArgs("foobar pe<20");
    expect(filters.peRatio.max).toBe(20);
    expect(filters.sector).toBeNull();
  });
});

// ── Filter application ──────────────────────────────────────────────

describe("applyFilters", () => {
  test("returns all results when no filters are active", () => {
    const filters = parseFilterArgs("");
    expect(applyFilters(SAMPLE_RESULTS, filters)).toHaveLength(4);
  });

  test("filters by sector", () => {
    const filters = parseFilterArgs("tech");
    const filtered = applyFilters(SAMPLE_RESULTS, filters);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.symbol).sort()).toEqual(["AAPL", "MSFT"]);
  });

  test("filters by P/E max", () => {
    const filters = parseFilterArgs("pe<20");
    const filtered = applyFilters(SAMPLE_RESULTS, filters);
    expect(filtered.map((r) => r.symbol).sort()).toEqual(["XOM"]);
  });

  test("filters by market cap minimum", () => {
    const filters = parseFilterArgs("mcap>1T");
    const filtered = applyFilters(SAMPLE_RESULTS, filters);
    expect(filtered.map((r) => r.symbol).sort()).toEqual(["AAPL", "MSFT"]);
  });

  test("filters by dividend yield minimum (excludes null)", () => {
    const filters = parseFilterArgs("div>1%");
    const filtered = applyFilters(SAMPLE_RESULTS, filters);
    // Only XOM (0.035 > 0.01) passes; AAPL (0.005), MSFT (0.007), TSLA (null) excluded
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.symbol).toBe("XOM");
  });

  test("combines multiple filters", () => {
    const filters = parseFilterArgs("tech pe<30");
    const filtered = applyFilters(SAMPLE_RESULTS, filters);
    // AAPL (pe=28.5) passes; MSFT (pe=35) excluded
    expect(filtered.map((r) => r.symbol).sort()).toEqual(["AAPL"]);
  });

  test("excludes results with null values for active range filters", () => {
    const filters = parseFilterArgs("pb<5");
    const filtered = applyFilters(SAMPLE_RESULTS, filters);
    // AAPL has pbRatio=2.5, XOM has 1.8, MSFT has 2.5 (default), TSLA has 10
    expect(filtered).toHaveLength(3);
    expect(filtered.map((r) => r.symbol)).not.toContain("TSLA");
  });
});

describe("filterScreenerRows", () => {
  test("matches symbols and names case-insensitively", () => {
    expect(filterScreenerRows(SAMPLE_RESULTS, "aapl").map((row) => row.symbol)).toEqual(["AAPL"]);
    expect(filterScreenerRows(SAMPLE_RESULTS, "APPLE").map((row) => row.symbol)).toEqual(["AAPL"]);
  });

  test("fuzzy-matches a subsequence against the company name", () => {
    expect(filterScreenerRows(SAMPLE_RESULTS, "aple").map((row) => row.symbol)).toEqual(["AAPL"]);
  });
});

// ── activeFilterCount ──────────────────────────────────────────────

describe("activeFilterCount", () => {
  test("returns 0 for default filters", () => {
    expect(activeFilterCount(parseFilterArgs(""))).toBe(0);
  });

  test("counts range filters", () => {
    expect(activeFilterCount(parseFilterArgs("pe<20 div>1%"))).toBe(2);
  });

  test("counts sector and exchange", () => {
    expect(activeFilterCount(parseFilterArgs("tech exch=NASDAQ"))).toBe(2);
  });
});

// ── extractScreenerResult ───────────────────────────────────────────

describe("extractScreenerResult", () => {
  test("extracts fundamentals from TickerFinancials", () => {
    const result = extractScreenerResult("AAPL", makeFinancials());
    expect(result.symbol).toBe("AAPL");
    expect(result.name).toBe("Apple Inc.");
    expect(result.exchange).toBe("NasdaqGS");
    expect(result.sector).toBe("Technology");
    expect(result.marketCap).toBe(2.9e12);
    expect(result.peRatio).toBe(28.5);
    expect(result.dividendYield).toBeCloseTo(0.005, 6);
  });

  test("computes P/B from marketCap / stockholdersEquity", () => {
    const financials = makeFinancials();
    const result = extractScreenerResult("AAPL", financials);
    expect(result.pbRatio).toBeCloseTo(2.9e12 / 62e9, 1);
  });

  test("computes debt-to-equity from totalDebt / stockholdersEquity", () => {
    const financials = makeFinancials();
    const result = extractScreenerResult("AAPL", financials);
    expect(result.debtToEquity).toBeCloseTo(100e9 / 62e9, 4);
  });

  test("computes revenue growth from annual statements", () => {
    const financials = makeFinancials({
      annualStatements: [
        { date: "2024-01-01", totalRevenue: 400e9, grossProfit: 200e9, netIncome: 100e9, totalDebt: 50e9, commonStockEquity: 80e9, dilutedShares: 15e9 },
        { date: "2023-01-01", totalRevenue: 350e9 },
      ],
    });
    const result = extractScreenerResult("AAPL", financials);
    expect(result.revenueGrowth).toBeCloseTo((400e9 - 350e9) / 350e9, 4);
  });

  test("computes gross margin from grossProfit / totalRevenue", () => {
    const financials = makeFinancials();
    const result = extractScreenerResult("AAPL", financials);
    expect(result.grossMargin).toBeCloseTo(169e9 / 383e9, 4);
  });

  test("computes net margin from netIncome / totalRevenue", () => {
    const financials = makeFinancials();
    const result = extractScreenerResult("AAPL", financials);
    expect(result.netMargin).toBeCloseTo(97e9 / 383e9, 4);
  });

  test("returns null for P/B when stockholdersEquity is missing", () => {
    const financials = makeFinancials({
      annualStatements: [{ date: "2024-01-01", totalRevenue: 100e9 }],
    });
    const result = extractScreenerResult("AAPL", financials);
    expect(result.pbRatio).toBeNull();
    expect(result.debtToEquity).toBeNull();
  });

  test("returns null for revenue growth when only one annual statement", () => {
    const financials = makeFinancials({
      annualStatements: [{ date: "2024-01-01", totalRevenue: 100e9 }],
      fundamentals: { trailingPE: 10 },
    });
    const result = extractScreenerResult("AAPL", financials);
    expect(result.revenueGrowth).toBeNull();
  });
});

// ── DEFAULT_UNIVERSE ────────────────────────────────────────────────

describe("DEFAULT_UNIVERSE", () => {
  test("contains a reasonable set of large-cap tickers", () => {
    expect(DEFAULT_UNIVERSE.length).toBeGreaterThan(30);
    expect(DEFAULT_UNIVERSE.length).toBeLessThan(100);
    expect(DEFAULT_UNIVERSE).toContain("AAPL");
    expect(DEFAULT_UNIVERSE).toContain("MSFT");
    expect(DEFAULT_UNIVERSE).toContain("JPM");
  });
});

// ── Model: columns and sorting ──────────────────────────────────────

describe("buildScreenerColumns", () => {
  test("produces columns with all expected IDs", () => {
    const columns = buildScreenerColumns(120);
    const ids = columns.map((c) => c.id);
    expect(ids).toContain("symbol");
    expect(ids).toContain("marketCap");
    expect(ids).toContain("peRatio");
    expect(ids).toContain("dividendYield");
    expect(columns.length).toBe(13);
  });
});

describe("sortRows", () => {
  test("sorts by market cap descending", () => {
    const pref: ScreenerSortPreference = { columnId: "marketCap", direction: "desc" };
    const sorted = sortRows(SAMPLE_RESULTS, pref);
    expect(sorted[0]!.symbol).toBe("MSFT"); // 3.1e12
    expect(sorted[1]!.symbol).toBe("AAPL"); // 2.9e12
  });

  test("sorts by P/E ascending", () => {
    const pref: ScreenerSortPreference = { columnId: "peRatio", direction: "asc" };
    const sorted = sortRows(SAMPLE_RESULTS, pref);
    expect(sorted[0]!.symbol).toBe("XOM"); // pe=12
  });
});

describe("nextSortPreference", () => {
  test("switches to new column with desc default", () => {
    const next = nextSortPreference({ columnId: "marketCap", direction: "desc" }, "peRatio");
    expect(next.columnId).toBe("peRatio");
    expect(next.direction).toBe("desc");
  });

  test("toggles direction on same column", () => {
    const next = nextSortPreference({ columnId: "peRatio", direction: "desc" }, "peRatio");
    expect(next.direction).toBe("asc");
  });

  test("returns to default after asc->desc->reset cycle", () => {
    const asc = nextSortPreference({ columnId: "peRatio", direction: "desc" }, "peRatio");
    const reset = nextSortPreference(asc, "peRatio");
    expect(reset).toEqual(DEFAULT_SORT_PREFERENCE);
  });
});
