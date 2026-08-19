import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import type { PluginPersistence } from "../../../types/plugin";
import type {
  AdjacentCandlesResponse,
  AdjacentConstituentsResponse,
  AdjacentEventsResponse,
  AdjacentIndex,
  AdjacentIndexPricesResponse,
  AdjacentIndicesResponse,
  AdjacentMarketDetail,
  AdjacentMarketsResponse,
  AdjacentNewsArticle,
  AdjacentNewsLatestResponse,
  AdjacentNewsResponse,
  AdjacentPricesResponse,
  AdjacentQuotesResponse,
  AdjacentRate,
  AdjacentRatePricesResponse,
  AdjacentRatesResponse,
  AdjacentSimilarResponse,
  AdjacentTradesResponse,
} from "./types";
import { unwrapAdjacentMarketIds, unwrapAdjacentNewsArticles } from "./normalize";
import { ADJACENT_CLOUD_CONNECTION_ID, adjacentCloudDataUrl, isHostedWebClient } from "../connections/adjacent-cloud";
import { withConnectionRequest } from "../connections/register";

const BASE_URL = "https://api.adjacent.markets/api/v1";
const DEFAULT_SOURCE_KEY = "adjacent";

function adjacentTransport(url: string, init?: RequestInit): Promise<Response> {
  if (url.startsWith("/")) return globalThis.fetch(url, init);
  return httpFetch(url, init);
}

const ADJACENT_FETCH = createThrottledFetch({
  requestsPerMinute: 60,
  maxRetries: 2,
  timeoutMs: 10_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-adjacent",
  },
  transport: adjacentTransport,
});

export const ADJACENT_CACHE_POLICIES = {
  markets: { staleMs: 30_000, expireMs: 10 * 60_000 },
  marketDetail: { staleMs: 10_000, expireMs: 5 * 60_000 },
  prices: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  candles: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  trades: { staleMs: 5_000, expireMs: 2 * 60_000 },
  quotes: { staleMs: 5_000, expireMs: 30_000 },
  similar: { staleMs: 5 * 60_000, expireMs: 30 * 60_000 },
  events: { staleMs: 30_000, expireMs: 10 * 60_000 },
  indices: { staleMs: 30_000, expireMs: 5 * 60_000 },
  constituents: { staleMs: 5 * 60_000, expireMs: 30 * 60_000 },
  indexPrices: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  rates: { staleMs: 30_000, expireMs: 5 * 60_000 },
  ratePrices: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  news: { staleMs: 2 * 60_000, expireMs: 7 * 24 * 60 * 60_000 },
} as const;

let adjacentPersistence: PluginPersistence | null = null;

export function attachAdjacentPersistence(persistence: PluginPersistence): void {
  adjacentPersistence = persistence;
}

export function resetAdjacentPersistence(): void {
  adjacentPersistence = null;
}

export interface AdjacentClientOptions {
  apiKey?: string | null;
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const origin = isHostedWebClient()
    ? adjacentCloudDataUrl("adjacent", path.replace(/^\//, ""))
    : `${BASE_URL}${path}`;
  const url = origin.startsWith("/")
    ? new URL(origin, "https://adjacent-cloud.local")
    : new URL(origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  if (origin.startsWith("/")) {
    return `${url.pathname}${url.search}`;
  }
  return url.toString();
}

function authHeaders(apiKey: string | null | undefined): Record<string, string> {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

function isPublicMode(apiKey: string | null | undefined): boolean {
  return !apiKey;
}

async function adjacentFetchJson<T>(
  url: string,
  apiKey: string | null | undefined,
): Promise<T> {
  return withConnectionRequest(ADJACENT_CLOUD_CONNECTION_ID, "fetch", async () => {
    const headers = isHostedWebClient() ? {} : authHeaders(apiKey);
    const response = await ADJACENT_FETCH.fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Adjacent request failed (${response.status}) for ${url}`);
    }
    const body = await response.text();
    return JSON.parse(body) as T;
  });
}

function getCached<T>(
  kind: string,
  key: string,
  options?: { allowExpired?: boolean },
): T | null {
  const record = adjacentPersistence?.getResource<T>(kind, key, {
    sourceKey: DEFAULT_SOURCE_KEY,
    allowExpired: options?.allowExpired,
  });
  return record?.value ?? null;
}

function setCached<T>(
  kind: string,
  key: string,
  value: T,
  cachePolicy: { staleMs: number; expireMs: number },
): void {
  adjacentPersistence?.setResource(kind, key, value, {
    sourceKey: DEFAULT_SOURCE_KEY,
    cachePolicy,
  });
}

async function loadCached<T>(
  kind: string,
  key: string,
  fetcher: () => Promise<T>,
  cachePolicy: { staleMs: number; expireMs: number },
): Promise<T> {
  const cached = adjacentPersistence?.getResource<T>(kind, key, {
    sourceKey: DEFAULT_SOURCE_KEY,
  });
  if (cached && cached.stale !== true && cached.staleAt > Date.now()) {
    return cached.value;
  }
  try {
    const next = await fetcher();
    setCached(kind, key, next, cachePolicy);
    return next;
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
}

export class AdjacentClient {
  constructor(private options: AdjacentClientOptions = {}) {}

  get apiKey(): string | null | undefined {
    return this.options.apiKey ?? null;
  }

  get isPublic(): boolean {
    return isPublicMode(this.options.apiKey);
  }

  private marketsPath(): string {
    return this.isPublic ? "/public/markets" : "/markets";
  }

  private indicesPath(): string {
    return this.isPublic ? "/public/indices" : "/indices";
  }

  private ratesPath(): string {
    return this.isPublic ? "/public/rates" : "/rates";
  }

  private newsPath(): string {
    return this.isPublic ? "/public/news" : "/news";
  }

  async getMarkets(params?: {
    platform?: string;
    category?: string;
    sort?: string;
    limit?: number;
    cursor?: string;
  }): Promise<AdjacentMarketsResponse> {
    const url = buildUrl(this.marketsPath(), {
      platform: params?.platform,
      category: params?.category,
      sort: params?.sort,
      limit: params?.limit,
      cursor: params?.cursor,
    });
    return loadCached(
      "adjacent-markets",
      url,
      () => adjacentFetchJson<AdjacentMarketsResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.markets,
    );
  }

  async searchMarkets(query: string, limit = 30): Promise<AdjacentMarketsResponse> {
    const url = buildUrl(this.marketsPath(), {
      q: query,
      limit,
    });
    // Don't cache search results persistently
    return adjacentFetchJson<AdjacentMarketsResponse>(url, this.apiKey);
  }

  async getMarket(id: string): Promise<AdjacentMarketDetail> {
    const url = buildUrl(`${this.marketsPath()}/${id}`);
    return loadCached(
      "adjacent-market-detail",
      id,
      () => adjacentFetchJson<AdjacentMarketDetail>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.marketDetail,
    );
  }

  async getMarketPrices(id: string, interval = "1h"): Promise<AdjacentPricesResponse> {
    const url = buildUrl(`${this.marketsPath()}/${id}/prices`, { interval });
    const cacheKey = `${id}:${interval}`;
    return loadCached(
      "adjacent-prices",
      cacheKey,
      () => adjacentFetchJson<AdjacentPricesResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.prices,
    );
  }

  async getMarketCandles(id: string, intervalMinutes = 60): Promise<AdjacentCandlesResponse> {
    const url = buildUrl(`${this.marketsPath()}/${id}/candles`, { interval: intervalMinutes });
    const cacheKey = `${id}:${intervalMinutes}`;
    return loadCached(
      "adjacent-candles",
      cacheKey,
      () => adjacentFetchJson<AdjacentCandlesResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.candles,
    );
  }

  async getMarketTrades(id: string): Promise<AdjacentTradesResponse> {
    const url = buildUrl(`${this.marketsPath()}/${id}/trades`);
    return loadCached(
      "adjacent-trades",
      id,
      () => adjacentFetchJson<AdjacentTradesResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.trades,
    );
  }

  async getMarketQuotes(id: string): Promise<AdjacentQuotesResponse> {
    const url = buildUrl(`${this.marketsPath()}/${id}/quotes`);
    return loadCached(
      "adjacent-quotes",
      id,
      () => adjacentFetchJson<AdjacentQuotesResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.quotes,
    );
  }

  async getSimilarMarkets(id: string): Promise<AdjacentSimilarResponse> {
    const url = buildUrl(`${this.marketsPath()}/${id}/similar`);
    return loadCached(
      "adjacent-similar",
      id,
      () => adjacentFetchJson<AdjacentSimilarResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.similar,
    );
  }

  async getEvents(params?: {
    platform?: string;
    category?: string;
    limit?: number;
    cursor?: string;
  }): Promise<AdjacentEventsResponse> {
    const url = buildUrl("/events", {
      platform: params?.platform,
      category: params?.category,
      limit: params?.limit,
      cursor: params?.cursor,
    });
    return loadCached(
      "adjacent-events",
      url,
      () => adjacentFetchJson<AdjacentEventsResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.events,
    );
  }

  async getIndices(): Promise<AdjacentIndicesResponse> {
    const url = buildUrl(this.indicesPath());
    return loadCached(
      "adjacent-indices",
      url,
      () => adjacentFetchJson<AdjacentIndicesResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.indices,
    );
  }

  async getIndex(id: string): Promise<AdjacentIndex> {
    const url = buildUrl(`${this.indicesPath()}/${id}`);
    return adjacentFetchJson<AdjacentIndex>(url, this.apiKey);
  }

  async getIndexConstituents(id: string): Promise<AdjacentConstituentsResponse> {
    const url = buildUrl(`${this.indicesPath()}/${id}/constituents`);
    return loadCached(
      "adjacent-constituents",
      id,
      () => adjacentFetchJson<AdjacentConstituentsResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.constituents,
    );
  }

  async getIndexPrices(id: string): Promise<AdjacentIndexPricesResponse> {
    const url = buildUrl(`${this.indicesPath()}/${id}/prices`);
    return loadCached(
      "adjacent-index-prices",
      id,
      () => adjacentFetchJson<AdjacentIndexPricesResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.indexPrices,
    );
  }

  async getIndexNews(id: string): Promise<AdjacentNewsResponse> {
    const url = buildUrl(`${this.indicesPath()}/${id}/news`);
    return loadCached(
      "adjacent-index-news",
      id,
      () => adjacentFetchJson<AdjacentNewsResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.news,
    );
  }

  async getRates(): Promise<AdjacentRatesResponse> {
    const url = buildUrl(this.ratesPath());
    return loadCached(
      "adjacent-rates",
      url,
      () => adjacentFetchJson<AdjacentRatesResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.rates,
    );
  }

  async getRate(id: string): Promise<AdjacentRate> {
    const url = buildUrl(`${this.ratesPath()}/${id}`);
    return adjacentFetchJson<AdjacentRate>(url, this.apiKey);
  }

  async getRatePrices(id: string): Promise<AdjacentRatePricesResponse> {
    const url = buildUrl(`${this.ratesPath()}/${id}/prices`);
    return loadCached(
      "adjacent-rate-prices",
      id,
      () => adjacentFetchJson<AdjacentRatePricesResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.ratePrices,
    );
  }

  async getNews(params?: { limit?: number; cursor?: string }): Promise<AdjacentNewsResponse> {
    const url = buildUrl(this.newsPath(), {
      limit: params?.limit,
      cursor: params?.cursor,
    });
    const raw = await loadCached(
      "adjacent-news",
      url,
      () => adjacentFetchJson<unknown>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.news,
    );
    return { news: unwrapAdjacentNewsArticles(raw) };
  }

  async getLatestNews(limit = 20): Promise<AdjacentNewsLatestResponse> {
    const url = buildUrl(`${this.newsPath()}/latest`, { limit });
    const raw = await loadCached(
      "adjacent-news-latest",
      url,
      () => adjacentFetchJson<unknown>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.news,
    );
    return { news: unwrapAdjacentNewsArticles(raw) };
  }

  async getNewsArticle(id: string): Promise<AdjacentNewsArticle> {
    const url = buildUrl(`${this.newsPath()}/${id}`);
    return adjacentFetchJson<AdjacentNewsArticle>(url, this.apiKey);
  }

  async getNewsMarkets(id: string): Promise<AdjacentMarketsResponse> {
    const url = buildUrl(`${this.newsPath()}/${id}/markets`);
    return adjacentFetchJson<AdjacentMarketsResponse>(url, this.apiKey);
  }

  async getMarketNews(marketId: string): Promise<AdjacentNewsResponse> {
    const url = buildUrl(`${this.marketsPath()}/${marketId}/news`);
    const raw = await loadCached(
      "adjacent-market-news",
      marketId,
      () => adjacentFetchJson<unknown>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.news,
    );
    return { news: unwrapAdjacentNewsArticles(raw) };
  }

  async searchMarketsByText(query: string, limit = 5): Promise<string[]> {
    const url = buildUrl(this.marketsPath(), {
      search: query,
      scope: this.isPublic ? "all" : undefined,
      per_page: limit,
      limit,
    });
    const raw = await adjacentFetchJson<unknown>(url, this.apiKey);
    return unwrapAdjacentMarketIds(raw).slice(0, limit);
  }
}

export { getCached as getAdjacentCached, setCached as setAdjacentCached };

let sharedApiKey: string | null = null;

/**
 * Records the Adjacent API key for cross-plugin consumers (e.g. the
 * prediction-markets detail tabs) that don't own the Adjacent config state.
 */
export function setSharedAdjacentApiKey(apiKey: string | null): void {
  sharedApiKey = apiKey;
}

/** Returns an Adjacent client using the last shared API key, if any. */
export function getSharedAdjacentClient(): AdjacentClient {
  return new AdjacentClient({ apiKey: sharedApiKey });
}
