/**
 * Adjacent Cloud keyed-data providers.
 *
 * Official prints are series keyed by station / ticker / series id — not
 * prediction-market tickers. Adding a source (NWS CLI, BLS first print,
 * CF Benchmarks, …) is a new {@link KeyedDataProvider} registration, not a
 * new one-off Worker route.
 *
 * Secrets stay on the Worker. Clients call `/api/data/{providerId}/…` and
 * never receive upstream API keys.
 *
 * Current providers: twc-kalshi, nws-cli, llm-stats, adjacent, votehub,
 * us-listings. They share one Connections row ("Adjacent Cloud").
 *
 * us-listings caches official Nasdaq Trader listed-symbol files (plus cheap
 * SEC OTC) for 12 hours. Clients hydrate search from GET
 * `/api/data/us-listings/universe` — Yahoo typeahead is not the master.
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
