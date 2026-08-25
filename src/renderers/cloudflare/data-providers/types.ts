/**
 * Hosted keyed-data providers (`GET /api/data/{providerId}/…`).
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
 * - `world-bank` — World Bank indicator prints (country + regional)
 * - `opensky` — OpenSky Network state vectors (delayed public)
 * - `digitraffic-ais` — Finnish Digitraffic public AIS
 * - `nasa-firms` — FIRMS VIIRS 24h hotspot CSV
 * - `nasa-gibs` — NASA GIBS / HLS WMS imagery
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

/**
 * `KEYED_DATA_ALIAS_PATH` is a blocker-safe twin of `KEYED_DATA_PATH`.
 *
 * Ad/tracker filter lists match on substrings, and `/api/data/adjacent/markets`
 * trips them: Chrome kills the request with `net::ERR_BLOCKED_BY_CLIENT` before
 * it leaves the browser, hands JavaScript a bare "Failed to fetch", and never
 * shows it in the network panel. Enterprise-installed blockers do this in
 * Incognito too, so the client needs a second route with no matchable token.
 */
import { ADJACENT_DATA_ALIAS_ID } from "../../../shared/hosted-api";

export {
  ADJACENT_DATA_ALIAS_ID,
  KEYED_DATA_ALIAS_PATH,
  KEYED_DATA_PATH,
} from "../../../shared/hosted-api";
export const TWC_KALSHI_ALIAS_PATH = "/api/weather/twc";

/** Neutral slug -> provider id, for provider names filter lists match. */
export const KEYED_DATA_PROVIDER_ALIASES: Record<string, string> = {
  [ADJACENT_DATA_ALIAS_ID]: "adjacent",
};

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
