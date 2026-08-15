// Adjacent API (api.adjacent.markets) response types.
// Markets are on a 0-100 cents scale; indices on a 50-150 scale.

export type AdjacentPlatform = "kalshi" | "polymarket";

export interface AdjacentMarket {
  id: string;
  platform: AdjacentPlatform;
  title: string;
  subtitle?: string;
  slug?: string;
  url?: string;
  category?: string;
  tags?: string[];
  status: string;
  ends_at?: string | null;
  updated_at?: string | null;
  // 0-100 cents
  yes_price: number | null;
  no_price: number | null;
  yes_bid?: number | null;
  yes_ask?: number | null;
  no_bid?: number | null;
  no_ask?: number | null;
  spread?: number | null;
  last_trade_price?: number | null;
  volume_24h?: number | null;
  total_volume?: number | null;
  open_interest?: number | null;
  liquidity?: number | null;
  event_id?: string;
  event_title?: string;
  description?: string;
  image?: string;
}

export interface AdjacentMarketsResponse {
  markets?: AdjacentMarket[];
  next_cursor?: string | null;
}

export interface AdjacentMarketDetail extends AdjacentMarket {
  rules?: string[];
  resolution_source?: string;
  event_ticker?: string;
  series_ticker?: string;
}

export interface AdjacentPricePoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AdjacentPricesResponse {
  prices?: AdjacentPricePoint[];
}

export interface AdjacentCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AdjacentCandlesResponse {
  candles?: AdjacentCandle[];
}

export interface AdjacentTrade {
  id: string;
  timestamp: string;
  side: "buy" | "sell";
  outcome: "yes" | "no";
  price: number;
  size: number;
}

export interface AdjacentTradesResponse {
  trades?: AdjacentTrade[];
}

export interface AdjacentQuoteLevel {
  price: number;
  size: number;
}

export interface AdjacentQuotesResponse {
  yes_bids?: AdjacentQuoteLevel[];
  yes_asks?: AdjacentQuoteLevel[];
  no_bids?: AdjacentQuoteLevel[];
  no_asks?: AdjacentQuoteLevel[];
  last_trade_price?: number | null;
}

export interface AdjacentSimilarMarket {
  id: string;
  platform: AdjacentPlatform;
  title: string;
  yes_price: number | null;
  volume_24h?: number | null;
  similarity?: number;
  url?: string;
  category?: string;
}

export interface AdjacentSimilarResponse {
  markets?: AdjacentSimilarMarket[];
}

export interface AdjacentEvent {
  id: string;
  title: string;
  platform: AdjacentPlatform;
  category?: string;
  status?: string;
  url?: string;
  description?: string;
  market_count?: number;
  markets?: AdjacentMarket[];
}

export interface AdjacentEventsResponse {
  events?: AdjacentEvent[];
  next_cursor?: string | null;
}

export interface AdjacentIndex {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  // 50-150 scale: value - 50 = win probability %
  value: number | null;
  change_1d?: number | null;
  change_7d?: number | null;
  change_30d?: number | null;
  category?: string;
  updated_at?: string | null;
}

export interface AdjacentIndicesResponse {
  indices?: AdjacentIndex[];
}

export interface AdjacentConstituent {
  market_id: string;
  title: string;
  platform: AdjacentPlatform;
  weight: number;
  yes_price: number | null;
  url?: string;
}

export interface AdjacentConstituentsResponse {
  constituents?: AdjacentConstituent[];
}

export interface AdjacentIndexPricePoint {
  date: Date;
  value: number;
}

export interface AdjacentIndexPricesResponse {
  prices?: Array<{ timestamp: string; value: number }>;
}

export interface AdjacentNewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  summary?: string;
  body?: string;
  published_at: string;
  image?: string;
  author?: string;
  categories?: string[];
  tickers?: string[];
  sentiment?: "positive" | "neutral" | "negative";
  importance?: number;
  related_market_ids?: string[];
}

export interface AdjacentNewsResponse {
  news?: AdjacentNewsArticle[];
  next_cursor?: string | null;
}

export interface AdjacentNewsLatestResponse {
  news?: AdjacentNewsArticle[];
}

export interface AdjacentRate {
  id: string;
  name: string;
  description?: string;
  value: number | null;
  spread?: number | null;
  category?: string;
  updated_at?: string | null;
  source_markets?: Array<{
    market_id: string;
    title: string;
    platform: AdjacentPlatform;
    weight: number;
  }>;
}

export interface AdjacentRatesResponse {
  rates?: AdjacentRate[];
}

export interface AdjacentRatePricesResponse {
  prices?: Array<{
    timestamp: string;
    value: number;
  }>;
}

// Gloomberb-internal normalized types

export interface AdjacentIndexRow {
  id: string;
  name: string;
  value: number | null;
  probabilityPct: number | null;
  change1d: number | null;
  change7d: number | null;
  category?: string;
}

export interface AdjacentRateRow {
  id: string;
  name: string;
  value: number | null;
  spread: number | null;
  category?: string;
}

export interface AdjacentPriceHistoryPoint {
  date: Date;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}
