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
  CftcFeed,
  CftcFiling,
  CftcFilingDetail,
  CftcFilingDocument,
  CftcFilingFilters,
  CftcFilingsPage,
  CftcFilingsQuery,
  CftcPageMeta,
} from "./types";
import {
  unwrapAdjacentMarketIds,
  unwrapAdjacentNewsArticles,
  unwrapAdjacentSimilarMarkets,
} from "./normalize";
import { keyedDataUrl, isHostedWebClient } from "../connections/adjacent-cloud";
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
  markets: { staleMs: 5 * 60_000, expireMs: 10 * 60_000 },
  marketDetail: { staleMs: 10_000, expireMs: 5 * 60_000 },
  prices: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  candles: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  trades: { staleMs: 5_000, expireMs: 2 * 60_000 },
  quotes: { staleMs: 5_000, expireMs: 30_000 },
  similar: { staleMs: 5 * 60_000, expireMs: 30 * 60_000 },
  events: { staleMs: 5 * 60_000, expireMs: 10 * 60_000 },
  indices: { staleMs: 5 * 60_000, expireMs: 10 * 60_000 },
  constituents: { staleMs: 5 * 60_000, expireMs: 30 * 60_000 },
  indexPrices: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  rates: { staleMs: 5 * 60_000, expireMs: 10 * 60_000 },
  ratePrices: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  news: { staleMs: 2 * 60_000, expireMs: 7 * 24 * 60 * 60_000 },
  filings: { staleMs: 2 * 60_000, expireMs: 30 * 60_000 },
  filingDetail: { staleMs: 5 * 60_000, expireMs: 30 * 60_000 },
} as const;

const CFTC_FEEDS: readonly CftcFeed[] = ["ptc_dcm_rules", "dcm_products", "dco", "dco_rules"];
const DEFAULT_FILINGS_PER_PAGE = 100;
const MAX_FILINGS_PER_PAGE = 500;

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asFeed(value: unknown): CftcFeed {
  return CFTC_FEEDS.includes(value as CftcFeed) ? value as CftcFeed : "dcm_products";
}

function parseFiling(raw: unknown): CftcFiling | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "number" ? record.id : Number(record.id);
  if (!Number.isFinite(id)) return null;
  const title = asString(record.title);
  if (!title) return null;
  return {
    id,
    title,
    feed: asFeed(record.feed),
    orgCode: asString(record.org_code) ?? "",
    status: asString(record.status) ?? "",
    statusDate: asDate(record.status_date) ?? new Date(0),
    docCount: typeof record.doc_count === "number" ? record.doc_count : 0,
    description: asString(record.description),
    productName: asString(record.product_name),
    productType: asString(record.product_type),
    category: asString(record.category),
    subcategory: asString(record.subcategory),
    productsAffected: asString(record.products_affected),
    remarks: asString(record.remarks),
    receiptDate: asDate(record.receipt_date),
    predictedEffectiveDate: asDate(record.predicted_effective_date),
    firstSeenAt: asDate(record.first_seen_at),
    lastSeenAt: asDate(record.last_seen_at),
  };
}

function parseDocument(raw: unknown): CftcFilingDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const url = asString(record.url);
  if (!url) return null;
  return { url, title: asString(record.title) ?? url };
}

function parseMeta(raw: unknown): CftcPageMeta {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    total: num(record.total),
    page: num(record.page) ?? 1,
    perPage: num(record.per_page) ?? DEFAULT_FILINGS_PER_PAGE,
    totalPages: num(record.total_pages),
    hasNext: record.has_next === true,
    hasPrev: record.has_prev === true,
    totalCapped: record.total_capped === true ? true : undefined,
  };
}

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
    ? keyedDataUrl("adjacent", path.replace(/^\//, ""))
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

/** Hosted injects ADJACENT_API_KEY on the worker; the browser has no BYOK key. */
function usesWorkerAdjacentKey(): boolean {
  return isHostedWebClient();
}

function isPublicMode(apiKey: string | null | undefined): boolean {
  if (usesWorkerAdjacentKey()) return false;
  return !apiKey;
}

function adjacentPriceInterval(interval: string): string {
  return interval === "1h" ? "1hour" : interval;
}

async function adjacentFetchJson<T>(
  url: string,
  apiKey: string | null | undefined,
): Promise<T> {
  return withConnectionRequest("adjacent", "fetch", async () => {
    const headers = isHostedWebClient() ? {} : authHeaders(apiKey);
    const response = await ADJACENT_FETCH.fetch(url, { headers });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Adjacent request unauthorized.");
      }
      throw new Error(`Adjacent request failed (${response.status}).`);
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

const inflightCached = new Map<string, Promise<unknown>>();

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
  const inflightKey = `${kind}:${key}`;
  const pending = inflightCached.get(inflightKey) as Promise<T> | undefined;
  if (pending) return pending;
  const work = (async () => {
    try {
      const next = await fetcher();
      setCached(kind, key, next, cachePolicy);
      return next;
    } catch (error) {
      if (cached) return cached.value;
      throw error;
    } finally {
      inflightCached.delete(inflightKey);
    }
  })();
  inflightCached.set(inflightKey, work);
  return work;
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

  private eventsPath(): string {
    return this.isPublic ? "/public/events" : "/events";
  }

  private newsPath(): string {
    return "/news";
  }

  private filingsPath(): string {
    return this.isPublic ? "/public/filings" : "/filings";
  }

  async getMarkets(params?: {
    platform?: string;
    category?: string;
    sort?: string;
    limit?: number;
    page?: number;
  }): Promise<AdjacentMarketsResponse> {
    const url = buildUrl(this.marketsPath(), {
      platform: params?.platform,
      category: params?.category,
      sort: params?.sort,
      per_page: params?.limit,
      page: params?.page,
      scope: this.isPublic ? "all" : undefined,
    });
    return loadCached(
      "adjacent-markets",
      url,
      () => adjacentFetchJson<AdjacentMarketsResponse>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.markets,
    );
  }

  async searchMarkets(
    query: string,
    limit = 30,
    platform?: string,
  ): Promise<AdjacentMarketsResponse> {
    const url = buildUrl(this.marketsPath(), {
      search: query,
      per_page: limit,
      page: 1,
      platform,
      scope: this.isPublic ? "all" : undefined,
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
    const url = buildUrl(`${this.marketsPath()}/${id}/prices`, {
      interval: adjacentPriceInterval(interval),
    });
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
    const url = buildUrl(`/markets/${id}/similar`);
    const raw = await loadCached(
      "adjacent-similar",
      id,
      () => adjacentFetchJson<unknown>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.similar,
    );
    return { markets: unwrapAdjacentSimilarMarkets(raw) };
  }

  async getEvents(params?: {
    platform?: string;
    category?: string;
    limit?: number;
    page?: number;
  }): Promise<AdjacentEventsResponse> {
    const url = buildUrl(this.eventsPath(), {
      platform: params?.platform,
      category: params?.category,
      per_page: params?.limit,
      page: params?.page,
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

  async getNews(params?: { limit?: number; offset?: number }): Promise<AdjacentNewsResponse> {
    const url = buildUrl(this.newsPath(), {
      limit: params?.limit,
      offset: params?.offset,
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
    const url = buildUrl(`${this.newsPath()}/latest`, { per_page: limit });
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

  async getMarketNews(
    marketId: string,
    params?: { limit?: number },
  ): Promise<AdjacentNewsResponse> {
    const limit = Math.max(10, params?.limit ?? 20);
    const url = buildUrl(`${this.marketsPath()}/${marketId}/news`, { per_page: limit });
    const raw = await loadCached(
      "adjacent-market-news",
      `${marketId}:${limit}`,
      () => adjacentFetchJson<unknown>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.news,
    );
    return { news: unwrapAdjacentNewsArticles(raw).slice(0, limit) };
  }

  async searchMarketsByText(
    query: string,
    limit = 5,
    platform?: string,
  ): Promise<string[]> {
    const url = buildUrl(this.marketsPath(), {
      search: query,
      scope: this.isPublic ? "all" : undefined,
      per_page: limit,
      platform,
    });
    const raw = await adjacentFetchJson<unknown>(url, this.apiKey);
    return unwrapAdjacentMarketIds(raw).slice(0, limit);
  }

  async listFilings(query: CftcFilingsQuery = {}): Promise<CftcFilingsPage> {
    const url = buildUrl(this.filingsPath(), {
      feed: query.feed,
      org: query.org,
      status: query.status,
      search: query.search?.trim() || undefined,
      page: query.page && query.page > 1 ? query.page : undefined,
      per_page: Math.min(query.perPage ?? DEFAULT_FILINGS_PER_PAGE, MAX_FILINGS_PER_PAGE),
    });
    const payload = await loadCached(
      "adjacent-filings",
      url,
      () => adjacentFetchJson<{ data?: unknown[]; meta?: unknown }>(url, this.apiKey),
      ADJACENT_CACHE_POLICIES.filings,
    );
    return {
      filings: (payload.data ?? [])
        .map(parseFiling)
        .filter((filing): filing is CftcFiling => filing !== null),
      meta: parseMeta(payload.meta),
    };
  }

  async getFilingDetail(id: number): Promise<CftcFilingDetail | null> {
    const url = buildUrl(`${this.filingsPath()}/${encodeURIComponent(String(id))}/markdown`);
    return loadCached(
      "adjacent-filing-detail",
      url,
      async () => {
        try {
          const payload = await adjacentFetchJson<{
            filing?: unknown;
            markdown?: unknown;
            documents?: unknown[];
            source_url?: unknown;
          }>(url, this.apiKey);
          const filing = parseFiling(payload.filing);
          if (!filing) return null;
          return {
            filing,
            markdown: asString(payload.markdown) ?? "",
            documents: (payload.documents ?? [])
              .map(parseDocument)
              .filter((doc): doc is CftcFilingDocument => doc !== null),
            sourceUrl: asString(payload.source_url) ?? "",
          };
        } catch (error) {
          if (error instanceof Error && /\(404\)/.test(error.message)) return null;
          throw error;
        }
      },
      ADJACENT_CACHE_POLICIES.filingDetail,
    );
  }

  async getFilingFilters(): Promise<CftcFilingFilters> {
    const url = buildUrl(`${this.filingsPath()}/filters`);
    const payload = await adjacentFetchJson<{
      feeds?: unknown[];
      orgs?: unknown[];
      statuses?: unknown[];
    }>(url, this.apiKey);
    const strings = (values: unknown[] | undefined): string[] =>
      (values ?? []).map(asString).filter((value): value is string => value !== undefined);
    return {
      feeds: strings(payload.feeds),
      orgs: strings(payload.orgs),
      statuses: strings(payload.statuses),
    };
  }
}

export async function loadCftcFilings(
  client: AdjacentClient,
  query: string,
  perPage = DEFAULT_FILINGS_PER_PAGE,
): Promise<CftcFilingsPage> {
  const normalized = query.trim();
  return client.listFilings(normalized ? { search: normalized, perPage } : { perPage });
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
