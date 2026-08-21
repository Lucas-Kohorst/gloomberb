import type { QuoteSubscriptionTarget } from "../../types/data-provider";
import { isLiveQuoteSubscriptionTarget } from "../../market-data/quote-subscription-target";
import { fetchCoinGeckoSearch, type CoinGeckoHttp, type CoinGeckoSearchCoin } from "./client";
import {
  COINGECKO_BASE_IDS,
  isCryptoMarketInstrument,
  resolveCoinGeckoPair,
  type CoinGeckoPair,
} from "./ids";

export function identityCacheKey(ticker: string, exchange = ""): string {
  return `${ticker.trim().toUpperCase()}:${exchange.trim().toUpperCase()}`;
}

export function pickCoinGeckoSearchCoins(
  coins: CoinGeckoSearchCoin[],
  query: string,
): CoinGeckoSearchCoin[] {
  const compactQuery = query.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const exact = coins.filter((coin) => coin.symbol.trim().toUpperCase() === compactQuery);
  return (exact.length > 0 ? exact : coins).slice().sort((a, b) => {
    const aRank = a.market_cap_rank ?? Number.POSITIVE_INFINITY;
    const bRank = b.market_cap_rank ?? Number.POSITIVE_INFINITY;
    return aRank - bRank;
  });
}

/**
 * Resolve ticker → CoinGecko id once per process. Known bases never hit
 * `/search`. Unknown CCC coins search at most once and are cached, including
 * misses. US-equity-style symbols never search-by-symbol.
 */
export class CoinGeckoIdentityCache {
  private readonly cache = new Map<string, CoinGeckoPair | null>();
  private readonly inflight = new Map<string, Promise<CoinGeckoPair | null>>();

  constructor(private readonly http: CoinGeckoHttp) {}

  peek(ticker: string, exchange = ""): CoinGeckoPair | null | undefined {
    return this.cache.get(identityCacheKey(ticker, exchange));
  }

  async resolve(ticker: string, exchange = ""): Promise<CoinGeckoPair | null> {
    const key = identityCacheKey(ticker, exchange);
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const task = this.lookup(ticker, exchange).then((pair) => {
      this.cache.set(key, pair);
      this.inflight.delete(key);
      return pair;
    }, (error) => {
      this.inflight.delete(key);
      throw error;
    });
    this.inflight.set(key, task);
    return task;
  }

  async resolveMany(
    targets: Array<{ symbol: string; exchange?: string }>,
  ): Promise<Array<{ target: { symbol: string; exchange?: string }; pair: CoinGeckoPair | null }>> {
    const unique = new Map<string, { symbol: string; exchange: string }>();
    for (const target of targets) {
      const exchange = target.exchange ?? "";
      const key = identityCacheKey(target.symbol, exchange);
      if (!unique.has(key)) unique.set(key, { symbol: target.symbol, exchange });
    }
    await Promise.all([...unique.values()].map((target) => this.resolve(target.symbol, target.exchange)));
    return targets.map((target) => ({
      target,
      pair: this.peek(target.symbol, target.exchange ?? "") ?? null,
    }));
  }

  private async lookup(ticker: string, exchange: string): Promise<CoinGeckoPair | null> {
    const mapped = resolveCoinGeckoPair(ticker, exchange);
    if (mapped) return mapped;
    if (!isCryptoMarketInstrument(ticker, exchange)) return null;
    const query = ticker.trim().toUpperCase()
      .replace(/=X$/i, "")
      .replace(/[/-]USD[T]?$/i, "")
      .replace(/[/\s]+/g, "");
    if (!query) return null;
    const known = COINGECKO_BASE_IDS[query];
    if (known) {
      return { id: known, base: query, vsCurrency: "usd", symbol: `${query}-USD` };
    }
    const response = await fetchCoinGeckoSearch(query, this.http);
    const match = pickCoinGeckoSearchCoins(response.coins ?? [], query)[0];
    if (!match || match.symbol.toUpperCase() !== query) return null;
    return {
      id: match.id,
      base: query,
      vsCurrency: "usd",
      symbol: `${query}-USD`,
    };
  }
}

export function liveCoinGeckoQuoteTargets(targets: QuoteSubscriptionTarget[]): QuoteSubscriptionTarget[] {
  return targets.filter((target) => (
    isLiveQuoteSubscriptionTarget(target)
    && isCryptoMarketInstrument(target.symbol, target.exchange)
  ));
}
