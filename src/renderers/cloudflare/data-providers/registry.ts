import { adjacentProvider } from "./adjacent";
import { llmStatsProvider } from "./llm-stats";
import { nwsCliProvider } from "./nws-cli";
import { twcKalshiProvider } from "./twc-kalshi";
import { usListingsProvider } from "./us-listings";
import { voteHubProvider } from "./votehub";
import type { KeyedDataProvider, KeyedDataProviderSummary } from "./types";

/**
 * Adjacent Cloud keyed-data providers. Add BLS / WU / CF Benchmarks / FOMC
 * here as a new module + this array entry. Do not add a one-off Worker route.
 *
 * adjacent, llm-stats, weather (TWC + NWS CLI), VoteHub, and US listings
 * (cached, keyless). VoteHub is on Adjacent Cloud even though the polls plugin
 * exists upstream. US listings is the security master — not Yahoo typeahead.
 *
 * Do not proxy Kalshi, Polymarket, Substack, RSS, or X.
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
  voteHubProvider,
  usListingsProvider,
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
