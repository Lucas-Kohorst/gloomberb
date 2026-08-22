import { withConnectionRequest } from "../../plugins/builtin/connections/register";
import { httpFetch } from "../../utils/http-transport";
import { createThrottledFetch } from "../../utils/throttled-fetch";
import { COINGECKO_CONNECTION_ID } from "./ids";
import type { CoinGeckoCoinPayload, CoinGeckoSimplePrice } from "./quotes";

const DEMO_BASE = "https://api.coingecko.com/api/v3";
const PRO_BASE = "https://pro-api.coingecko.com/api/v3";

export interface CoinGeckoAuth {
  apiKey?: string | null;
  pro?: boolean;
}

let auth: CoinGeckoAuth = {};

export function setCoinGeckoAuth(next: CoinGeckoAuth): void {
  auth = {
    apiKey: next.apiKey?.trim() || null,
    pro: next.pro === true || Boolean(process.env.COINGECKO_PRO_API_KEY),
  };
}

export function resolveCoinGeckoAuth(): CoinGeckoAuth {
  const apiKey = auth.apiKey
    || process.env.COINGECKO_PRO_API_KEY
    || process.env.COINGECKO_API_KEY
    || null;
  return {
    apiKey,
    pro: auth.pro === true || Boolean(process.env.COINGECKO_PRO_API_KEY),
  };
}

function defaultHeaders(current: CoinGeckoAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    // Hosted SPA runs in the browser; the Worker proxies without a UA unless
    // we stamp one. CoinGecko has 403'd anonymous/empty user agents before.
    "User-Agent": "gloomberb-coingecko",
  };
  const key = current.apiKey?.trim();
  if (key) {
    headers[current.pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key;
  }
  return headers;
}

const CLIENT = createThrottledFetch({
  requestsPerMinute: 12,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  transport: (url, init) => httpFetch(url, init),
});

export interface CoinGeckoHttp {
  fetchJson<T>(path: string, search?: Record<string, string | number | undefined>): Promise<T>;
}

function buildUrl(path: string, search: Record<string, string | number | undefined> | undefined, current: CoinGeckoAuth): string {
  const base = current.pro ? PRO_BASE : DEMO_BASE;
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function createCoinGeckoHttp(): CoinGeckoHttp {
  return {
    async fetchJson<T>(path: string, search?: Record<string, string | number | undefined>): Promise<T> {
      const current = resolveCoinGeckoAuth();
      const url = buildUrl(path, search, current);
      const response = await CLIENT.fetch(url, { headers: defaultHeaders(current) });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        throw new Error(`[${response.status}] ${detail || `CoinGecko request failed for ${path}`}`);
      }
      return response.json() as Promise<T>;
    },
  };
}

const defaultHttp = createCoinGeckoHttp();

function connected<T>(operation: string, run: () => Promise<T>): Promise<T> {
  return withConnectionRequest(COINGECKO_CONNECTION_ID, operation, run);
}

export function fetchCoinGeckoSimplePrice(
  ids: readonly string[],
  vsCurrency: string,
  http: CoinGeckoHttp = defaultHttp,
): Promise<Record<string, CoinGeckoSimplePrice>> {
  return connected("simple-price", () => http.fetchJson("/simple/price", {
    ids: [...new Set(ids)].join(","),
    vs_currencies: vsCurrency.toLowerCase(),
    include_market_cap: "true",
    include_24hr_vol: "true",
    include_24hr_change: "true",
    include_last_updated_at: "true",
  }));
}

export function fetchCoinGeckoCoin(
  id: string,
  http: CoinGeckoHttp = defaultHttp,
): Promise<CoinGeckoCoinPayload> {
  return connected("coin", () => http.fetchJson(`/coins/${encodeURIComponent(id)}`, {
    localization: "false",
    tickers: "false",
    market_data: "true",
    community_data: "false",
    developer_data: "false",
    sparkline: "false",
  }));
}

export function fetchCoinGeckoMarketChart(
  id: string,
  vsCurrency: string,
  days: string,
  http: CoinGeckoHttp = defaultHttp,
): Promise<{ prices?: Array<[number, number]>; total_volumes?: Array<[number, number]> }> {
  return connected("market-chart", () => http.fetchJson(`/coins/${encodeURIComponent(id)}/market_chart`, {
    vs_currency: vsCurrency.toLowerCase(),
    days,
  }));
}

export function fetchCoinGeckoOhlc(
  id: string,
  vsCurrency: string,
  days: string,
  http: CoinGeckoHttp = defaultHttp,
): Promise<Array<[number, number, number, number, number]>> {
  return connected("ohlc", () => http.fetchJson(`/coins/${encodeURIComponent(id)}/ohlc`, {
    vs_currency: vsCurrency.toLowerCase(),
    days,
  }));
}

export interface CoinGeckoSearchCoin {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank?: number | null;
}

export function fetchCoinGeckoSearch(
  query: string,
  http: CoinGeckoHttp = defaultHttp,
): Promise<{ coins?: CoinGeckoSearchCoin[] }> {
  return connected("search", () => http.fetchJson("/search", { query }));
}
