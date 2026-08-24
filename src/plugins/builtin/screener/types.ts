/**
 * Fundamental stock screener filter and result types.
 */

export type MarginKind = "gross" | "net";

/**
 * Numeric range filter. `null` means unbounded on that side.
 * Values are in natural units (market cap in USD, ratios as raw numbers,
 * growth/margin/yield as fractions, e.g. 0.15 = 15%).
 */
export interface RangeFilter {
  min: number | null;
  max: number | null;
}

export interface ScreenerFilters {
  marketCap: RangeFilter;
  peRatio: RangeFilter;
  pbRatio: RangeFilter;
  debtToEquity: RangeFilter;
  revenueGrowth: RangeFilter;
  margin: RangeFilter;
  marginKind: MarginKind;
  dividendYield: RangeFilter;
  sector: string | null;
  exchange: string | null;
}

export const DEFAULT_FILTERS: ScreenerFilters = {
  marketCap: { min: null, max: null },
  peRatio: { min: null, max: null },
  pbRatio: { min: null, max: null },
  debtToEquity: { min: null, max: null },
  revenueGrowth: { min: null, max: null },
  margin: { min: null, max: null },
  marginKind: "net",
  dividendYield: { min: null, max: null },
  sector: null,
  exchange: null,
};

/** A single stock's fundamental metrics after extraction from TickerFinancials. */
export interface ScreenerResult {
  symbol: string;
  name: string;
  exchange: string;
  sector: string | null;
  price: number | null;
  marketCap: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  debtToEquity: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  dividendYield: number | null;
  currency: string;
}
