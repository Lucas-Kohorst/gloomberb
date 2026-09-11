export const CBOE_BOOK_PLUGIN_ID = "cboe-book";
export const CBOE_BOOK_CONNECTION_ID = "cboe-book";
export const CBOE_BOOK_PANE_ID = "cboe-book";

export const CBOE_BOOK_BASE_URL = "https://www.cboe.com/json";
export const CBOE_BOOK_PAGE_BASE_URL =
  "https://www.cboe.com/us/equities/market_statistics/book";

export type CboeMarket = "bzx" | "byx" | "edgx" | "edga";

export const CBOE_MARKETS: readonly CboeMarket[] = ["bzx", "byx", "edgx", "edga"];
export const DEFAULT_CBOE_MARKET: CboeMarket = "bzx";

export function normalizeCboeMarket(value: unknown): CboeMarket {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (CBOE_MARKETS as readonly string[]).includes(normalized)
    ? (normalized as CboeMarket)
    : DEFAULT_CBOE_MARKET;
}

/** One price level: shares available at a limit price. */
export interface CboeBookLevel {
  shares: number;
  price: number;
}

/** One recent print from the Last 10 Trades tape. */
export interface CboeBookTrade {
  /** Exchange timestamp as printed, e.g. "16:19:09". Never bullet-prefixed. */
  time: string;
  shares: number;
  price: number;
}

export interface CboeBook {
  symbol: string;
  company: string | null;
  prev: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  last: number | null;
  change: number | null;
  volume: number | null;
  orders: number | null;
  /** Asks sorted ascending (best ask first). */
  asks: CboeBookLevel[];
  /** Bids sorted descending (best bid first). */
  bids: CboeBookLevel[];
  /** Most recent trade first, up to 10. */
  trades: CboeBookTrade[];
  /** Exchange timestamp as printed, e.g. "16:19:43". */
  timestamp: string | null;
  status: string | null;
}

export interface CboeBookStats {
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  spreadBps: number | null;
  mid: number | null;
}
