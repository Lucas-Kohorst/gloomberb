/**
 * Fundamental data fetching and extraction for the screener.
 *
 * Uses the asset-data capability (Yahoo Finance via getTickerFinancials)
 * to fetch fundamentals for a curated universe of large-cap US tickers.
 * Fetching full financials for hundreds of tickers is rate-limited, so
 * we use a reasonable default universe and cache results with a TTL.
 */

import type { AssetDataProvider } from "../../../types/data-provider";
import type { TickerFinancials } from "../../../types/financials";
import type { ScreenerResult } from "./types";
import { withConnectionRequest } from "../connections/register";

export const SCREENER_CONNECTION_ID = "yahoo-fundamentals";

/**
 * Default universe: a curated set of large-cap US equities spanning major
 * sectors. Kept to ~60 names to respect Yahoo Finance rate limits while
 * still providing a useful screening universe.
 */
export const DEFAULT_UNIVERSE: readonly string[] = [
  // Technology
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "META", "AMZN", "AVGO", "ORCL",
  "ADBE", "CRM", "INTC", "AMD", "QCOM", "TXN", "IBM", "NOW", "INTU",
  // Healthcare
  "UNH", "LLY", "JNJ", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR",
  // Financials
  "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "AXP", "BLK",
  // Consumer
  "WMT", "PG", "KO", "PEP", "COST", "MCD", "NKE", "SBUX", "TGT", "HD",
  // Energy
  "XOM", "CVX", "COP",
  // Industrials / Materials
  "CAT", "BA", "GE", "LIN", "UNP",
  // Communication
  "DIS", "NFLX", "CMCSA",
  // Utilities
  "NEE", "DUK",
  // Real Estate
  "PLD", "AMT",
];

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  results: ScreenerResult[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<ScreenerResult[]> | null = null;

/**
 * Extract screener-relevant fundamental metrics from a TickerFinancials object.
 */
export function extractScreenerResult(
  symbol: string,
  financials: TickerFinancials,
): ScreenerResult {
  const quote = financials.quote;
  const fundamentals = financials.fundamentals;
  const profile = financials.profile;
  const annual = financials.annualStatements;

  const latestAnnual = annual[0] ?? null;
  const priorAnnual = annual[1] ?? null;

  const marketCap = quote?.marketCap ?? null;

  // P/B ratio = marketCap / stockholdersEquity (book value)
  const stockholdersEquity = latestAnnual?.commonStockEquity
    ?? latestAnnual?.totalEquityGrossMinorityInterest
    ?? null;
  const pbRatio = (marketCap != null && stockholdersEquity != null && stockholdersEquity > 0)
    ? marketCap / stockholdersEquity
    : null;

  // Debt-to-equity = totalDebt / stockholdersEquity
  const totalDebt = latestAnnual?.totalDebt ?? null;
  const debtToEquity = (totalDebt != null && stockholdersEquity != null && stockholdersEquity > 0)
    ? totalDebt / stockholdersEquity
    : null;

  // Revenue growth = (latestRevenue - priorRevenue) / priorRevenue
  const latestRevenue = latestAnnual?.totalRevenue ?? null;
  const priorRevenue = priorAnnual?.totalRevenue ?? null;
  const revenueGrowth = (latestRevenue != null && priorRevenue != null && priorRevenue > 0)
    ? (latestRevenue - priorRevenue) / priorRevenue
    : (fundamentals?.revenueGrowth ?? null);

  // Gross margin = grossProfit / totalRevenue
  const grossProfit = latestAnnual?.grossProfit ?? null;
  const grossMargin = (grossProfit != null && latestRevenue != null && latestRevenue > 0)
    ? grossProfit / latestRevenue
    : null;

  // Net margin = netIncome / totalRevenue
  const netIncome = latestAnnual?.netIncome ?? fundamentals?.netIncome ?? null;
  const netMargin = (netIncome != null && latestRevenue != null && latestRevenue > 0)
    ? netIncome / latestRevenue
    : (fundamentals?.profitMargin ?? null);

  return {
    symbol,
    name: quote?.name ?? symbol,
    exchange: quote?.listingExchangeName ?? quote?.exchangeName ?? "",
    sector: profile?.sector ?? null,
    price: quote?.price ?? null,
    marketCap,
    peRatio: fundamentals?.trailingPE ?? fundamentals?.forwardPE ?? null,
    pbRatio,
    debtToEquity,
    revenueGrowth,
    grossMargin,
    netMargin,
    dividendYield: fundamentals?.dividendYield ?? null,
    currency: quote?.currency ?? "USD",
  };
}

/**
 * Fetch fundamentals for a universe of tickers via the asset-data client.
 * Uses getTickerFinancialsBatch when available, otherwise falls back to
 * individual fetches with limited concurrency.
 *
 * Results are cached with a TTL to avoid repeated rate-limited requests.
 */
export async function fetchUniverseFundamentals(
  dataProvider: AssetDataProvider,
  universe: readonly string[] = DEFAULT_UNIVERSE,
  options?: { forceRefresh?: boolean },
): Promise<ScreenerResult[]> {
  if (cache && !options?.forceRefresh && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.results;
  }

  if (inflight && !options?.forceRefresh) return inflight;

  inflight = doFetch(dataProvider, universe)
    .then((results) => {
      cache = { results, fetchedAt: Date.now() };
      return results;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

async function doFetch(
  dataProvider: AssetDataProvider,
  universe: readonly string[],
): Promise<ScreenerResult[]> {
  const targets = universe.map((symbol) => ({ symbol, exchange: "" }));

  if (dataProvider.getTickerFinancialsBatch) {
    return withConnectionRequest(SCREENER_CONNECTION_ID, "fundamentals-batch", async () => {
      const batchResults = await dataProvider.getTickerFinancialsBatch!(targets);
      const results: ScreenerResult[] = [];
      for (const result of batchResults) {
        if (result.financials) {
          try {
            results.push(extractScreenerResult(result.target.symbol, result.financials));
          } catch {
            // skip extraction failures
          }
        }
      }
      return results;
    });
  }

  // Fallback: individual fetches with limited concurrency
  return withConnectionRequest(SCREENER_CONNECTION_ID, "fundamentals-individual", async () => {
    const results: ScreenerResult[] = [];
    const concurrency = 5;
    for (let i = 0; i < universe.length; i += concurrency) {
      const batch = universe.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        batch.map(async (symbol) => {
          const financials = await dataProvider.getTickerFinancials(symbol, "");
          return extractScreenerResult(symbol, financials);
        }),
      );
      for (const result of settled) {
        if (result.status === "fulfilled") results.push(result.value);
      }
    }
    return results;
  });
}

/** Test helper: clear the in-memory cache. */
export function resetScreenerCache(): void {
  cache = null;
  inflight = null;
}
