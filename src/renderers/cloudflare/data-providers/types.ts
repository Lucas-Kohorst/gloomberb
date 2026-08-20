/**
 * Adjacent Cloud keyed-data providers.
 *
 * Official prints are series keyed by station / ticker / series id — not
 * prediction-market tickers. Adding a source is a new
 * {@link KeyedDataProvider} registration, not a new one-off Worker route.
 *
 * Secrets stay on the Worker. Clients call `/api/data/{providerId}/…` and
 * never receive upstream API keys. Hosted users share one origin pull plus
 * isolate cache; desktop still hits public endpoints directly.
 *
 * Registered now:
 * - `twc-kalshi` — The Weather Company Kalshi climate / hourly (alias `/api/weather/twc`)
 * - `nws-cli` — NWS Daily Climate Report first-final CLI print
 * - `votehub` — VoteHub polls
 * - `llm-stats` — AI model metadata + runtime metrics
 * - `adjacent` — Adjacent indices, rates, markets
 * - `us-listings` — Nasdaq Trader listed files + SEC OTC, 12h cache
 * - `owid` — Our World in Data grapher CSV + metadata (slug + entity code)
 *
 * Worker secrets (CoS sets these; do not commit values):
 *   wrangler secret put ADJACENT_API_KEY
 *
 * Next settlement / reference prints (register here when a first-party API
 * exists; do not scrape):
 * - BLS first print (CPI, employment)
 * - EIA weekly petroleum and electricity
 * - NOAA / NCEI climate normals
 * - CME daily settlements
 * - CF Benchmarks crypto reference rates (license)
 * - AP Elections / Decision Desk
 * - BEA GDP and Census retail sales
 * - CFTC COT
 *
 * Do not proxy Kalshi, Polymarket, Substack, RSS, X, or Jina.
 * Bond Search / FRED stays on Gloom Cloud. Weather Underground stays off
 * until a first-party API exists.
 */

export const KEYED_DATA_PATH = "/api/data";
export const TWC_KALSHI_ALIAS_PATH = "/api/weather/twc";

export { NWS_CLI_USER_AGENT } from "../../../sources/nws-cli/types";
export const TWC_KALSHI_USER_AGENT = "gloomberb-weather";

export interface ProviderSecretAttach {
  /** Cloudflare Worker secret / env var name. Never forwarded to the client. */
  envKey: string;
  headerName: string;
  headerValue?: (secret: string) => string;
}

export interface ProviderResolveContext {
  /** Path after `/api/data/{id}/`, no leading slash. */
  keyPath: string;
  search: URLSearchParams;
  env: Env;
}

export type ProviderPlan =
  | {
      kind: "proxy";
      url: string;
      extraHeaders?: Record<string, string>;
    }
  | {
      kind: "print";
      cacheKey: string;
      load: (fetchImpl: typeof fetch) => Promise<unknown>;
    }
  | {
      kind: "error";
      status: number;
      error: string;
    };

/**
 * One upstream print source. Register in `registry.ts`. Future providers
 * (Weather Underground, BLS, FOMC, AP Elections, Chainlink TWAP, …) add a
 * file here and an entry in the registry — they do not add Worker routes.
 */
export interface KeyedDataProvider {
  id: string;
  name: string;
  ttlSeconds: number;
  userAgent: string;
  secret?: ProviderSecretAttach;
  resolve: (ctx: ProviderResolveContext) => ProviderPlan | Promise<ProviderPlan>;
}

export interface KeyedDataProviderSummary {
  id: string;
  name: string;
  ttlSeconds: number;
}
