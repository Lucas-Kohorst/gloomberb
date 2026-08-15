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

export interface AdjacentMeta {
  total?: number;
  page?: number;
  per_page?: number;
  total_pages?: number;
  has_next?: boolean;
  has_prev?: boolean;
}

export interface AdjacentIndex {
  index_id: string;
  name: string;
  ticker?: string;
  description?: string;
  office_category?: string | null;
  party_side?: string | null;
  // base-100 index level: 100 is neutral, each point = 1pp of blended win probability
  latest_price: number | null;
  change_1d?: number | null;
  change_7d?: number | null;
  change_30d?: number | null;
  updated_at?: string | null;
}

export interface AdjacentIndicesResponse {
  data?: AdjacentIndex[];
  meta?: AdjacentMeta;
}

export interface AdjacentConstituent {
  kind?: "market" | "index";
  market_id: string;
  ticker?: string;
  display_ticker?: string;
  platform: string;
  weight: number;
  price?: number | null;
  name?: string | null;
}

export interface AdjacentConstituentsResponse {
  data?: AdjacentConstituent[];
  meta?: AdjacentMeta;
}

export interface AdjacentIndexPricePoint {
  date: Date;
  value: number;
}

export interface AdjacentPriceSample {
  timestamp: string;
  price: number | null;
}

export interface AdjacentIndexPricesResponse {
  data?: AdjacentPriceSample[];
  meta?: AdjacentMeta;
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

export interface AdjacentRateSource {
  market_id: string;
  display_ticker?: string;
  platform: string;
  weight: number;
  question?: string | null;
  latest_price?: number | null;
  end_date?: string | null;
  is_active?: boolean | null;
}

export interface AdjacentRate {
  rate_id: string;
  name: string;
  description?: string | null;
  methodology?: string;
  // 0-100 scale: 52.4 means 52.4 percent
  latest_price: number | null;
  spread?: number | null;
  previous_close_1d?: number | null;
  price_change_1d?: number | null;
  price_change_7d?: number | null;
  sources?: AdjacentRateSource[];
}

export interface AdjacentRatesResponse {
  data?: AdjacentRate[];
  meta?: AdjacentMeta;
}

export interface AdjacentRatePricesResponse {
  data?: AdjacentPriceSample[];
  meta?: AdjacentMeta;
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
