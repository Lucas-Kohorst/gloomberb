import { assetDataProvider } from "../../capabilities";
import { createProviderMiss } from "../provider-errors";
import type {
  AssetDataProvider,
  CachedFinancialsTarget,
  MarketDataRequestContext,
  QuoteBatchResult,
  QuoteSubscriptionTarget,
  SearchRequestContext,
  TickerFinancialsBatchResult,
} from "../../types/data-provider";
import type { PricePoint, Quote, TickerFinancials } from "../../types/financials";
import type { InstrumentSearchResult } from "../../types/instrument";
import type { TimeRange } from "../../time-series/range";
import type { ChartResolutionSupport, ManualChartResolution } from "../../time-series/resolution";
import { computeHistoryReturn } from "../../utils/price-history";
import {
  fetchCoinGeckoCoin,
  fetchCoinGeckoMarketChart,
  fetchCoinGeckoOhlc,
  fetchCoinGeckoSearch,
  fetchCoinGeckoSimplePrice,
  type CoinGeckoHttp,
  createCoinGeckoHttp,
} from "./client";
import {
  aggregateCoinGeckoHistory,
  coinGeckoDaysForRange,
  coinGeckoDaysForResolution,
  getCoinGeckoChartResolutionSupport,
  mapCoinGeckoMarketChart,
  mapCoinGeckoOhlc,
} from "./history";
import {
  COINGECKO_EXCHANGE,
  COINGECKO_PROVIDER_ID,
  isCryptoMarketInstrument,
  resolveCoinGeckoPair,
  shouldSearchCoinGecko,
  type CoinGeckoPair,
} from "./ids";
import { CoinGeckoIdentityCache, liveCoinGeckoQuoteTargets, pickCoinGeckoSearchCoins } from "./identity";
import { mapCoinGeckoCoinQuote, mapCoinGeckoSimpleQuote } from "./quotes";

export const COINGECKO_QUOTE_POLL_INTERVAL_MS = 15_000;

const OHLC_DAYS = new Set(["1", "7", "14", "30", "90", "180", "365", "max"]);

export class CoinGeckoProvider implements AssetDataProvider {
  readonly id = COINGECKO_PROVIDER_ID;
  readonly name = "CoinGecko";
  readonly priority = 80;
  private readonly identity: CoinGeckoIdentityCache;

  constructor(private readonly http: CoinGeckoHttp = createCoinGeckoHttp()) {
    this.identity = new CoinGeckoIdentityCache(http);
  }

  canProvide(ticker: string, exchange?: string, _context?: MarketDataRequestContext): boolean {
    return isCryptoMarketInstrument(ticker, exchange);
  }

  getChartResolutionSupport(): ChartResolutionSupport[] {
    return getCoinGeckoChartResolutionSupport();
  }

  getChartResolutionCapabilities(): ManualChartResolution[] {
    return getCoinGeckoChartResolutionSupport().map((entry) => entry.resolution);
  }

  async getQuote(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<Quote> {
    const pair = await this.requirePair(ticker, exchange);
    const payload = await fetchCoinGeckoSimplePrice([pair.id], pair.vsCurrency, this.http);
    const price = payload[pair.id];
    if (!price) throw createProviderMiss(`CoinGecko quote is unavailable for ${pair.symbol}`);
    return mapCoinGeckoSimpleQuote({
      symbol: pair.symbol,
      vsCurrency: pair.vsCurrency,
      price,
    });
  }

  async getQuotesBatch(
    targets: QuoteSubscriptionTarget[],
    _options?: { forceRefresh?: boolean },
  ): Promise<QuoteBatchResult[]> {
    const resolved = await this.identity.resolveMany(targets);
    const idsByVs = new Map<string, string[]>();
    for (const entry of resolved) {
      if (!entry.pair) continue;
      const list = idsByVs.get(entry.pair.vsCurrency) ?? [];
      list.push(entry.pair.id);
      idsByVs.set(entry.pair.vsCurrency, list);
    }
    const quotes = new Map<string, Quote>();
    for (const [vsCurrency, ids] of idsByVs) {
      const payload = await fetchCoinGeckoSimplePrice(ids, vsCurrency, this.http);
      for (const entry of resolved) {
        if (!entry.pair || entry.pair.vsCurrency !== vsCurrency) continue;
        const price = payload[entry.pair.id];
        if (!price) continue;
        quotes.set(`${entry.target.symbol}:${entry.target.exchange ?? ""}`, mapCoinGeckoSimpleQuote({
          symbol: entry.pair.symbol,
          vsCurrency,
          price,
        }));
      }
    }
    return resolved.map(({ target }) => ({
      target,
      quote: quotes.get(`${target.symbol}:${target.exchange ?? ""}`) ?? null,
    }));
  }

  subscribeQuotes(
    targets: QuoteSubscriptionTarget[],
    onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void {
    const cryptoTargets = liveCoinGeckoQuoteTargets(targets);
    if (cryptoTargets.length === 0) return () => {};

    let cancelled = false;
    const pull = async (): Promise<void> => {
      try {
        const results = await this.getQuotesBatch(cryptoTargets);
        if (cancelled) return;
        for (const item of results) {
          if (item.quote) onQuote(item.target, item.quote);
        }
      } catch {
        // Poll is best-effort; the next interval retries.
      }
    };

    void pull();
    const intervalId = setInterval(() => {
      if (!cancelled) void pull();
    }, COINGECKO_QUOTE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }

  async getTickerFinancialsBatch(
    targets: CachedFinancialsTarget[],
  ): Promise<TickerFinancialsBatchResult[]> {
    return Promise.all(targets.map(async (target) => {
      if (!isCryptoMarketInstrument(target.symbol, target.exchange)) {
        return { target, financials: null };
      }
      try {
        return { target, financials: await this.getTickerFinancials(target.symbol, target.exchange) };
      } catch (error) {
        return { target, financials: null, error };
      }
    }));
  }

  async getTickerFinancials(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<TickerFinancials> {
    const pair = await this.requirePair(ticker, exchange);
    const [coin, chart] = await Promise.all([
      fetchCoinGeckoCoin(pair.id, this.http),
      fetchCoinGeckoMarketChart(pair.id, pair.vsCurrency, "max", this.http),
    ]);
    const quote = mapCoinGeckoCoinQuote({
      symbol: pair.symbol,
      vsCurrency: pair.vsCurrency,
      coin,
    });
    const priceHistory = mapCoinGeckoMarketChart(chart.prices ?? [], chart.total_volumes);
    const return1Y = computeHistoryReturn(priceHistory, 365);
    return {
      quote,
      profile: coin.description?.en ? { description: coin.description.en, industry: "Crypto" } : { industry: "Crypto" },
      fundamentals: return1Y == null ? undefined : { return1Y },
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory,
    };
  }

  async getPriceHistory(
    ticker: string,
    exchange: string,
    range: TimeRange,
    _context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    const pair = await this.requirePair(ticker, exchange);
    return this.loadHistory(pair, coinGeckoDaysForRange(range), range === "1D" ? "5m" : "1d");
  }

  async getPriceHistoryForResolution(
    ticker: string,
    exchange: string,
    bufferRange: TimeRange,
    resolution: ManualChartResolution,
    _context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    const pair = await this.requirePair(ticker, exchange);
    const days = coinGeckoDaysForResolution(bufferRange, resolution);
    return this.loadHistory(pair, days, resolution);
  }

  async getExchangeRate(_fromCurrency: string): Promise<number> {
    throw createProviderMiss("CoinGecko does not provide FX rates");
  }

  async search(query: string, _context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    const trimmed = query.trim();
    if (!shouldSearchCoinGecko(trimmed)) return [];
    const mapped = resolveCoinGeckoPair(trimmed, COINGECKO_EXCHANGE);
    const response = await fetchCoinGeckoSearch(mapped?.base ?? trimmed, this.http);
    const coins = pickCoinGeckoSearchCoins(response.coins ?? [], mapped?.base ?? trimmed);
    return coins.slice(0, 10).map((coin) => {
      const base = coin.symbol.trim().toUpperCase();
      return {
        providerId: this.id,
        symbol: `${base}-USD`,
        name: coin.name,
        exchange: COINGECKO_EXCHANGE,
        type: "CRYPTO",
        currency: "USD",
      };
    });
  }

  async getArticleSummary(_url: string): Promise<string | null> {
    return null;
  }

  private async loadHistory(
    pair: CoinGeckoPair,
    days: string,
    resolution: ManualChartResolution,
  ): Promise<PricePoint[]> {
    const useOhlc = (resolution === "1d" || resolution === "1wk" || resolution === "1mo" || resolution === "1h" || resolution === "4h")
      && OHLC_DAYS.has(days);
    if (useOhlc) {
      try {
        const rows = await fetchCoinGeckoOhlc(pair.id, pair.vsCurrency, days, this.http);
        const mapped = mapCoinGeckoOhlc(rows);
        if (mapped.length > 0) return aggregateCoinGeckoHistory(mapped, resolution);
      } catch {
        // Fall through to close-only market_chart.
      }
    }
    const chart = await fetchCoinGeckoMarketChart(pair.id, pair.vsCurrency, days, this.http);
    const mapped = mapCoinGeckoMarketChart(chart.prices ?? [], chart.total_volumes);
    return aggregateCoinGeckoHistory(mapped, resolution);
  }

  private async requirePair(ticker: string, exchange: string): Promise<CoinGeckoPair> {
    const pair = await this.resolvePair(ticker, exchange);
    if (!pair) throw createProviderMiss(`CoinGecko has no mapping for ${ticker}`);
    return pair;
  }

  private resolvePair(ticker: string, exchange: string): Promise<CoinGeckoPair | null> {
    return this.identity.resolve(ticker, exchange);
  }
}

export function createCoinGeckoCapabilities(provider = new CoinGeckoProvider()) {
  return [assetDataProvider(provider)];
}
