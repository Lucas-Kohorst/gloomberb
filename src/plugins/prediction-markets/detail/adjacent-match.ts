import { useEffect, useState } from "react";
import type { AdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentMarket } from "../../builtin/adjacent/types";
import { extractPolymarketSlug } from "../services/polymarket/normalize";
import type { PredictionVenue } from "../types";

const RESOLVE_TIMEOUT_MS = 12_000;
const TITLE_SEARCH_WORDS = 4;
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "will", "be", "to", "of", "in", "on", "at", "by", "for",
  "and", "or", "vs", "versus", "than", "more", "less", "above", "below",
  "over", "under", "this", "that", "with", "from",
]);

export interface AdjacentMarketLookup {
  venue?: PredictionVenue | null;
  marketId?: string | null;
  eventId?: string | null;
  eventTicker?: string | null;
  seriesTicker?: string | null;
  conditionId?: string | null;
  title?: string | null;
  url?: string | null;
}

export interface AdjacentMarketMatch {
  marketId: string | null;
  loading: boolean;
  error: string | null;
  triedIds: string[];
}

const resolvedIds = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

export function resetAdjacentMarketMatchCache(): void {
  resolvedIds.clear();
  inFlight.clear();
}

export function kalshiParentTickers(ticker: string): string[] {
  const parts = ticker.trim().toUpperCase().split("-").filter(Boolean);
  const parents: string[] = [];
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const parent = parts.slice(0, i).join("-");
    if (/[0-9]/.test(parent)) parents.push(parent);
  }
  return parents;
}

function compactId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function stripPlatformPrefix(value: string): string {
  return value.replace(/^(kalshi|polymarket):/i, "");
}

function alreadyPrefixed(value: string): boolean {
  return /^(kalshi|polymarket):/i.test(value.trim());
}

function isGammaNumericId(value: string): boolean {
  return /^\d+$/.test(stripPlatformPrefix(value));
}

function pushUnique(target: string[], value: string | null | undefined): void {
  const next = compactId(value);
  if (!next) return;
  if (!target.includes(next)) target.push(next);
}

export function adjacentMarketCandidateIds(lookup: AdjacentMarketLookup): string[] {
  const venue = lookup.venue;
  const canonical: string[] = [];
  const numeric: string[] = [];
  const rawMarketId = compactId(lookup.marketId);
  const rawEventTicker = compactId(lookup.eventTicker);
  const rawEventId = compactId(lookup.eventId);
  const rawConditionId = compactId(lookup.conditionId);
  const slug = lookup.url ? extractPolymarketSlug(lookup.url) : null;

  const pushCandidate = (value: string | null | undefined) => {
    const next = compactId(value);
    if (!next) return;
    pushUnique(isGammaNumericId(next) ? numeric : canonical, next);
  };

  if (venue === "polymarket" && slug) pushCandidate(`polymarket:${slug}`);
  if (venue === "polymarket" && rawConditionId) {
    pushCandidate(`polymarket:${rawConditionId}`);
  }

  if (rawMarketId && alreadyPrefixed(rawMarketId)) {
    pushCandidate(rawMarketId);
  } else if (venue && rawMarketId) {
    pushCandidate(`${venue}:${rawMarketId}`);
  }

  if (venue && rawEventTicker) pushCandidate(`${venue}:${rawEventTicker}`);
  if (venue && rawEventId) pushCandidate(`${venue}:${rawEventId}`);

  if (venue === "kalshi") {
    const ticker = stripPlatformPrefix(rawMarketId || rawEventTicker).toUpperCase();
    if (ticker) {
      for (const parent of kalshiParentTickers(ticker)) {
        pushCandidate(`kalshi:${parent}`);
      }
    }
  }

  return [...canonical, ...numeric];
}

export function adjacentMarketSearchQueries(lookup: AdjacentMarketLookup): string[] {
  const queries: string[] = [];
  const tickerLike = [
    compactId(lookup.marketId) ? stripPlatformPrefix(lookup.marketId!) : "",
    compactId(lookup.eventTicker),
    compactId(lookup.seriesTicker),
    compactId(lookup.eventId),
    compactId(lookup.conditionId),
    lookup.url ? extractPolymarketSlug(lookup.url) : "",
  ];
  for (const value of tickerLike) {
    if (value && !/\s/.test(value)) pushUnique(queries, value);
  }

  const titleQuery = simplifiedTitleQuery(lookup.title);
  if (titleQuery) pushUnique(queries, titleQuery);
  return queries;
}

export function simplifiedTitleQuery(title: string | null | undefined): string | null {
  if (!title?.trim()) return null;
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9.\- ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !TITLE_STOPWORDS.has(word));
  if (words.length === 0) return null;
  return words.slice(0, TITLE_SEARCH_WORDS).join(" ");
}

export function adjacentMarketLookupKey(lookup: AdjacentMarketLookup): string {
  return [
    lookup.venue ?? "",
    compactId(lookup.marketId).toLowerCase(),
    compactId(lookup.eventTicker).toLowerCase(),
    compactId(lookup.eventId).toLowerCase(),
    compactId(lookup.conditionId).toLowerCase(),
    compactId(lookup.title).toLowerCase(),
  ].join("|");
}

function marketIdFromPayload(value: unknown, fallback: string): string | null {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const nested = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : record;
  for (const key of ["id", "market_id"]) {
    const raw = nested[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return fallback;
}

function idsMatchCandidate(id: string, lookup: AdjacentMarketLookup): boolean {
  const needle = id.trim().toLowerCase();
  const raws = [
    compactId(lookup.marketId),
    compactId(lookup.eventTicker),
    compactId(lookup.eventId),
    compactId(lookup.conditionId),
    lookup.url ? extractPolymarketSlug(lookup.url) ?? "" : "",
  ]
    .filter(Boolean)
    .map((value) => stripPlatformPrefix(value).toLowerCase());
  if (raws.some((raw) => needle === raw || needle.endsWith(`:${raw}`))) return true;
  if (lookup.venue && raws.some((raw) => needle === `${lookup.venue}:${raw}`)) return true;
  return false;
}

function pickFromMarkets(
  markets: readonly AdjacentMarket[],
  lookup: AdjacentMarketLookup,
): string | null {
  const venueMarkets = lookup.venue
    ? markets.filter((market) => market.platform === lookup.venue)
    : markets;
  const pool = venueMarkets.length > 0 ? venueMarkets : markets;
  const exact = pool.find((market) => idsMatchCandidate(market.id, lookup)
    || (market.slug != null && idsMatchCandidate(market.slug, lookup)));
  if (exact) return exact.id;
  const title = compactId(lookup.title).toLowerCase();
  if (title) {
    const titleMatch = pool.find((market) => {
      const candidate = market.title.toLowerCase();
      return candidate.includes(title.slice(0, 24)) || title.includes(candidate.slice(0, 24));
    });
    if (titleMatch) return titleMatch.id;
  }
  return pool[0]?.id ?? null;
}

async function tryGetMarket(client: AdjacentClient, id: string): Promise<string | null> {
  try {
    const detail = await client.getMarket(id);
    return marketIdFromPayload(detail, id);
  } catch {
    return null;
  }
}

async function lookupAdjacentMarketId(
  client: AdjacentClient,
  lookup: AdjacentMarketLookup,
): Promise<string | null> {
  const candidates = adjacentMarketCandidateIds(lookup);
  for (const id of candidates) {
    const found = await tryGetMarket(client, id);
    if (found) return found;
  }

  const queries = adjacentMarketSearchQueries(lookup);
  const platform = lookup.venue ?? undefined;
  for (const query of queries) {
    const findIds = await client.searchMarketsByText(query, 8, platform).catch(() => [] as string[]);
    const exactFind = findIds.find((id) => idsMatchCandidate(id, lookup));
    if (exactFind) return exactFind;
    for (const id of findIds) {
      if (platform && alreadyPrefixed(id) && !id.toLowerCase().startsWith(`${platform}:`)) {
        continue;
      }
      const found = await tryGetMarket(client, id);
      if (found) return found;
      if (id) return id;
    }

    const search = await client.searchMarkets(query, 8, platform).catch(() => null);
    const picked = pickFromMarkets(search?.markets ?? [], lookup);
    if (picked) return picked;
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Adjacent lookup timed out."));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function resolveAdjacentMarketId(
  client: AdjacentClient,
  lookup: AdjacentMarketLookup | string,
): Promise<string | null> {
  const normalized: AdjacentMarketLookup = typeof lookup === "string"
    ? { title: lookup }
    : lookup;
  const cacheKey = adjacentMarketLookupKey(normalized);
  if (!cacheKey.replace(/\|/g, "")) return Promise.resolve(null);
  const resolved = resolvedIds.get(cacheKey);
  if (resolved !== undefined) return Promise.resolve(resolved);
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const work = withTimeout(
    lookupAdjacentMarketId(client, normalized),
    RESOLVE_TIMEOUT_MS,
  )
    .then((id) => {
      resolvedIds.set(cacheKey, id);
      return id;
    })
    .catch((error: unknown) => {
      resolvedIds.delete(cacheKey);
      throw error;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, work);
  return work;
}

function lookupIsEmpty(lookup: AdjacentMarketLookup): boolean {
  return !compactId(lookup.marketId)
    && !compactId(lookup.eventTicker)
    && !compactId(lookup.eventId)
    && !compactId(lookup.title);
}

export function useAdjacentMarketMatch(
  client: AdjacentClient | null,
  lookup: AdjacentMarketLookup | string,
): AdjacentMarketMatch {
  const normalized: AdjacentMarketLookup = typeof lookup === "string"
    ? { title: lookup }
    : lookup;
  const cacheKey = adjacentMarketLookupKey(normalized);
  const triedIds = adjacentMarketCandidateIds(normalized);
  const [match, setMatch] = useState<AdjacentMarketMatch>({
    marketId: null,
    loading: !!client && !lookupIsEmpty(normalized),
    error: null,
    triedIds,
  });

  useEffect(() => {
    if (!client || lookupIsEmpty(normalized)) {
      setMatch({ marketId: null, loading: false, error: null, triedIds });
      return;
    }
    let cancelled = false;
    setMatch({ marketId: null, loading: true, error: null, triedIds });
    resolveAdjacentMarketId(client, normalized)
      .then((marketId) => {
        if (!cancelled) {
          setMatch({ marketId, loading: false, error: null, triedIds });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMatch({
          marketId: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          triedIds,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client, cacheKey]);

  return match;
}
