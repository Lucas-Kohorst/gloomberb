import { getSharedAdjacentClient } from "../adjacent/client";
import {
  adjacentPriceHistoryToPricePoints,
  normalizeAdjacentPriceHistory,
} from "../adjacent/normalize";
import type { AdjacentMarket } from "../adjacent/types";
import type { PricePoint } from "../../../types/financials";
import { pollRaceKey } from "./normalize";
import type { PollRow } from "./types";

const POLL_TYPE_MARKET_TERMS: Record<string, string> = {
  governor: "governor",
  "us-senator": "senate",
  "us-representative": "house",
  "generic-ballot": "generic ballot",
  approval: "approval",
  favorability: "favorability",
};

const STOP_WORDS = new Set([
  "the", "and", "for", "of", "in", "to", "a", "on", "at", "by", "or",
  "poll", "polling", "yes", "no", "will", "win",
]);

export interface PollRaceMarketOverlay {
  marketId: string;
  label: string;
  points: PricePoint[];
}

export function pollRaceMarketQuery(row: Pick<PollRow, "subject" | "seatName" | "pollType">, choice?: string | null): string {
  const race = pollRaceKey(row);
  const office = POLL_TYPE_MARKET_TERMS[row.pollType];
  const parts = [race];
  if (office && !race.toLowerCase().includes(office)) parts.push(office);
  if (choice?.trim()) parts.push(choice.trim());
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function tokenizePollMarketQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function scoreAdjacentMarketForPoll(market: AdjacentMarket, query: string): number {
  const tokens = tokenizePollMarketQuery(query);
  if (tokens.length === 0) return 0;
  const haystack = `${market.title} ${market.event_title ?? ""} ${market.subtitle ?? ""}`.toLowerCase();
  let score = 0;
  let nonYearHits = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) continue;
    const yearToken = /^\d{4}$/.test(token);
    score += yearToken ? 1 : token.length >= 4 ? 3 : 2;
    if (!yearToken) nonYearHits += 1;
  }
  if (nonYearHits === 0) return 0;
  if (market.status === "open" || market.status === "active") score += 1;
  return score;
}

export function pickAdjacentMarketForPoll(
  markets: readonly AdjacentMarket[],
  query: string,
): AdjacentMarket | null {
  const tokens = tokenizePollMarketQuery(query);
  if (tokens.length === 0 || markets.length === 0) return null;
  let best: AdjacentMarket | null = null;
  let bestScore = 0;
  for (const market of markets) {
    const score = scoreAdjacentMarketForPoll(market, query);
    if (score > bestScore) {
      best = market;
      bestScore = score;
    }
  }
  // Require a real token hit so a random first result is not overlaid.
  return bestScore > 0 ? best : null;
}

const overlayCache = new Map<string, PollRaceMarketOverlay | null>();
const overlayInFlight = new Map<string, Promise<PollRaceMarketOverlay | null>>();

export async function loadPollRaceMarketOverlay(
  query: string,
  load: {
    search: (query: string) => Promise<readonly AdjacentMarket[]>;
    prices: (id: string) => Promise<PricePoint[]>;
  } = defaultOverlayLoaders(),
): Promise<PollRaceMarketOverlay | null> {
  const cacheKey = query.trim().toLowerCase();
  if (!cacheKey) return null;
  if (overlayCache.has(cacheKey)) return overlayCache.get(cacheKey) ?? null;
  const pending = overlayInFlight.get(cacheKey);
  if (pending) return pending;

  const lookup = (async () => {
    const markets = await load.search(query);
    const match = pickAdjacentMarketForPoll(markets, query);
    if (!match) {
      overlayCache.set(cacheKey, null);
      return null;
    }
    const points = await load.prices(match.id);
    if (points.length === 0) {
      overlayCache.set(cacheKey, null);
      return null;
    }
    const overlay: PollRaceMarketOverlay = {
      marketId: match.id,
      label: `PM ${match.title}`,
      points,
    };
    overlayCache.set(cacheKey, overlay);
    return overlay;
  }).finally(() => {
    overlayInFlight.delete(cacheKey);
  });

  overlayInFlight.set(cacheKey, lookup);
  return lookup;
}

function defaultOverlayLoaders(): {
  search: (query: string) => Promise<readonly AdjacentMarket[]>;
  prices: (id: string) => Promise<PricePoint[]>;
} {
  return {
    search: async (query) => {
      const client = getSharedAdjacentClient();
      const response = await client.searchMarkets(query, 8);
      return response.markets ?? [];
    },
    prices: async (id) => {
      const client = getSharedAdjacentClient();
      const response = await client.getMarketPrices(id, "1d");
      return adjacentPriceHistoryToPricePoints(normalizeAdjacentPriceHistory(response.prices ?? []));
    },
  };
}

export function resetPollRaceMarketOverlayCache(): void {
  overlayCache.clear();
  overlayInFlight.clear();
}
