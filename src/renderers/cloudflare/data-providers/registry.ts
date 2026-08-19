import { nwsCliProvider } from "./nws-cli";
import { twcKalshiProvider } from "./twc-kalshi";
import type { KeyedDataProvider, KeyedDataProviderSummary } from "./types";

/**
 * Adjacent Cloud keyed-data providers. Add BLS / WU / CF Benchmarks / FOMC
 * here as a new module + this array entry. Do not add a one-off Worker route.
 *
 * Weather Underground is intentionally unregistered until a first-party API
 * (no scrape) is available.
 */
const PROVIDERS: readonly KeyedDataProvider[] = [
  twcKalshiProvider,
  nwsCliProvider,
];

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function getKeyedDataProvider(id: string): KeyedDataProvider | undefined {
  return BY_ID.get(id);
}

export function listKeyedDataProviders(): KeyedDataProviderSummary[] {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    ttlSeconds: provider.ttlSeconds,
  }));
}
