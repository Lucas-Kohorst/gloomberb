import { adjacentProvider } from "./adjacent";
import { llmStatsProvider } from "./llm-stats";
import { nwsCliProvider } from "./nws-cli";
import { twcKalshiProvider } from "./twc-kalshi";
import type { KeyedDataProvider, KeyedDataProviderSummary } from "./types";

/**
 * Adjacent Cloud keyed-data providers. Add BLS / WU / CF Benchmarks / FOMC
 * here as a new module + this array entry. Do not add a one-off Worker route.
 *
 * Bundle list is fork-only data plugins vs gloom-sh/gloomberb `main`:
 * adjacent, llm-stats (AIBENCH / api.llm-stats.com), weather (TWC + NWS CLI).
 *
 * Do not proxy Kalshi, Polymarket, Substack, RSS, VoteHub, or X.
 * News/Jina stays client-side. Bond Search uses Gloom Cloud FRED, not this registry.
 *
 * Weather Underground is intentionally unregistered until a first-party API
 * (no scrape) is available.
 */
const PROVIDERS: readonly KeyedDataProvider[] = [
  twcKalshiProvider,
  nwsCliProvider,
  llmStatsProvider,
  adjacentProvider,
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
