import type { Quote } from "../../types/financials";
import { COINGECKO_EXCHANGE, COINGECKO_PROVIDER_ID } from "./ids";

export interface CoinGeckoSimplePrice {
  last_updated_at?: number;
  [key: string]: number | undefined;
}

export interface CoinGeckoMarketData {
  current_price?: Record<string, number>;
  price_change_24h_in_currency?: Record<string, number>;
  price_change_percentage_24h?: number;
  market_cap?: Record<string, number>;
  total_volume?: Record<string, number>;
  high_24h?: Record<string, number>;
  low_24h?: Record<string, number>;
  last_updated?: string;
}

export interface CoinGeckoCoinPayload {
  id?: string;
  symbol?: string;
  name?: string;
  last_updated?: string;
  description?: { en?: string };
  market_data?: CoinGeckoMarketData;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function quoteChange(price: number, changePercent: number | undefined): { change: number; previousClose?: number } {
  if (changePercent == null || !Number.isFinite(changePercent)) return { change: 0 };
  const previousClose = price / (1 + changePercent / 100);
  if (!Number.isFinite(previousClose) || previousClose <= 0) return { change: 0 };
  return { change: price - previousClose, previousClose };
}

export function mapCoinGeckoSimpleQuote(input: {
  symbol: string;
  vsCurrency: string;
  price: CoinGeckoSimplePrice;
  name?: string;
  now?: number;
}): Quote {
  const vs = input.vsCurrency.toLowerCase();
  const price = finiteNumber(input.price[vs]);
  if (price == null || price <= 0) {
    throw new Error(`CoinGecko quote is missing ${vs} price for ${input.symbol}`);
  }
  const changePercent = finiteNumber(input.price[`${vs}_24h_change`]);
  const { change, previousClose } = quoteChange(price, changePercent);
  return {
    symbol: input.symbol,
    providerId: COINGECKO_PROVIDER_ID,
    price,
    currency: vs.toUpperCase(),
    change,
    changePercent: changePercent ?? 0,
    previousClose,
    marketCap: finiteNumber(input.price[`${vs}_market_cap`]),
    volume: finiteNumber(input.price[`${vs}_24h_vol`]),
    name: input.name,
    lastUpdated: input.now ?? Date.now(),
    exchangeName: COINGECKO_EXCHANGE,
    listingExchangeName: COINGECKO_EXCHANGE,
    marketState: "REGULAR",
    sessionConfidence: "derived",
    dataSource: "delayed",
  };
}

export function mapCoinGeckoCoinQuote(input: {
  symbol: string;
  vsCurrency: string;
  coin: CoinGeckoCoinPayload;
  now?: number;
}): Quote {
  const vs = input.vsCurrency.toLowerCase();
  const market = input.coin.market_data;
  const price = finiteNumber(market?.current_price?.[vs]);
  if (price == null || price <= 0) {
    throw new Error(`CoinGecko quote is missing ${vs} price for ${input.symbol}`);
  }
  const changePercent = finiteNumber(market?.price_change_percentage_24h);
  const change = finiteNumber(market?.price_change_24h_in_currency?.[vs]);
  const derived = quoteChange(price, changePercent);
  return {
    symbol: input.symbol,
    providerId: COINGECKO_PROVIDER_ID,
    price,
    currency: vs.toUpperCase(),
    change: change ?? derived.change,
    changePercent: changePercent ?? 0,
    previousClose: derived.previousClose,
    high: finiteNumber(market?.high_24h?.[vs]),
    low: finiteNumber(market?.low_24h?.[vs]),
    marketCap: finiteNumber(market?.market_cap?.[vs]),
    volume: finiteNumber(market?.total_volume?.[vs]),
    name: input.coin.name,
    lastUpdated: input.now ?? Date.now(),
    exchangeName: COINGECKO_EXCHANGE,
    listingExchangeName: COINGECKO_EXCHANGE,
    marketState: "REGULAR",
    sessionConfidence: "derived",
    dataSource: "delayed",
  };
}
