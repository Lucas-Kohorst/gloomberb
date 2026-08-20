import { SHARE_HOSTED_ORIGIN } from "../../shares/routes";
import type { InstrumentSearchResult } from "../../types/instrument";
import { createThrottledFetch } from "../../utils/throttled-fetch";
import { httpFetch } from "../../utils/http-transport";
import {
  adjacentCloudDataUrl,
  isHostedWebClient,
} from "../../plugins/builtin/connections/adjacent-cloud";
import { withConnectionRequest } from "../../plugins/builtin/connections/register";
import { printToUniverse } from "./parse";
import { searchUsListingsUniverse } from "./search";
import {
  US_LISTINGS_PROVIDER_ID,
  US_LISTINGS_TTL_SECONDS,
  type UsListingsUniverse,
} from "./types";

const LISTINGS_FETCH = createThrottledFetch({
  requestsPerMinute: 12,
  maxRetries: 1,
  timeoutMs: 12_000,
  backoffBaseMs: 400,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

let cached: { expiresAt: number; universe: UsListingsUniverse } | null = null;
let inflight: Promise<UsListingsUniverse | null> | null = null;
let testUniverse: UsListingsUniverse | null | undefined;

function bunTestRuntime(): boolean {
  if (typeof process === "undefined") return false;
  const argv = process.argv ?? [];
  if (argv.some((arg) => /\.test\.(ts|tsx|js|jsx)$/.test(arg))) return true;
  return argv[1] === "test";
}

export function usListingsUniverseUrl(): string {
  const path = adjacentCloudDataUrl(US_LISTINGS_PROVIDER_ID, "universe");
  if (isHostedWebClient()) return path;
  return `${SHARE_HOSTED_ORIGIN}${path}`;
}

export function setUsListingsUniverseForTests(universe: UsListingsUniverse | null | undefined): void {
  testUniverse = universe;
  cached = universe ? { expiresAt: Date.now() + universe.ttlSeconds * 1000, universe } : null;
  inflight = null;
}

export function resetUsListingsClient(): void {
  testUniverse = undefined;
  cached = null;
  inflight = null;
}

async function fetchUniverse(): Promise<UsListingsUniverse | null> {
  return withConnectionRequest(US_LISTINGS_PROVIDER_ID, "us-listings", async () => {
    const response = await LISTINGS_FETCH.fetch(usListingsUniverseUrl());
    if (!response.ok) return null;
    const universe = printToUniverse(await response.json() as Record<string, unknown>);
    return universe;
  });
}

export async function ensureUsListingsUniverse(): Promise<UsListingsUniverse | null> {
  if (testUniverse !== undefined) return testUniverse;
  if (cached && cached.expiresAt > Date.now()) return cached.universe;
  if (bunTestRuntime() && process.env.GLOOMBERB_US_LISTINGS_LIVE !== "1") return null;
  if (inflight) return inflight;

  inflight = fetchUniverse()
    .then((universe) => {
      if (universe) {
        const ttlMs = Math.max(60_000, (universe.ttlSeconds || US_LISTINGS_TTL_SECONDS) * 1000);
        cached = { expiresAt: Date.now() + ttlMs, universe };
      }
      return universe;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function searchUsListedUniverse(query: string): Promise<InstrumentSearchResult[]> {
  const universe = await ensureUsListingsUniverse();
  if (!universe) return [];
  return searchUsListingsUniverse(universe, query);
}
