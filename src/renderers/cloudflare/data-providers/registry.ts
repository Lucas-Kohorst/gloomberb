import { adjacentProvider } from "./adjacent";
import { adjacentDevProvider } from "./adjacent-dev";
import { llmStatsProvider } from "./llm-stats";
import { nwsCliProvider } from "./nws-cli";
import { owidProvider } from "./owid";
import {
  digitrafficAisProvider,
  nasaFirmsProvider,
  nasaGibsProvider,
  openskyProvider,
  worldBankProvider,
} from "./research-origin";
import { twcKalshiProvider } from "./twc-kalshi";
import { usListingsProvider } from "./us-listings";
import { voteHubProvider } from "./votehub";
import type { KeyedDataProvider, KeyedDataProviderSummary } from "./types";

/**
 * Hosted keyed-data providers (`GET /api/data/{provider}`). Add BLS / WU /
 * CF Benchmarks / FOMC here as a new module + this array entry. Do not add a
 * one-off Worker route.
 *
 * adjacent, llm-stats, weather (TWC + NWS CLI), VoteHub, US listings, OWID,
 * plus keyless research origin proxies (World Bank, OpenSky, Digitraffic AIS,
 * NASA FIRMS, NASA GIBS). Those research sources register their own Connections
 * rows — do not add them to ADJACENT_CLOUD_PROVIDER_IDS.
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
  adjacentDevProvider,
  voteHubProvider,
  usListingsProvider,
  owidProvider,
  worldBankProvider,
  openskyProvider,
  digitrafficAisProvider,
  nasaFirmsProvider,
  nasaGibsProvider,
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
