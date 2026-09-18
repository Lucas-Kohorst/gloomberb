import type { PredictionMarketSummary } from "../../types";
import { fetchJson } from "../fetch";
import {
  extractPolymarketSlug,
  hydratePolymarketMarket,
  normalizePolymarketMarket,
} from "./normalize";
import type { PolymarketEventRecord, PolymarketMarketRecord } from "./types";

const MAX_POLYMARKET_SEARCH_HYDRATE = 20;

function isHexId(value: string | undefined): boolean {
  return !!value && /^0x[0-9a-f]+$/i.test(value);
}

export function polymarketEventSlugForSummary(
  market: Pick<PredictionMarketSummary, "eventId" | "marketId" | "url">,
): string | null {
  const fromUrl = extractPolymarketSlug(market.url);
  if (fromUrl) return fromUrl;
  const eventId = market.eventId?.trim();
  if (eventId && !/^\d+$/.test(eventId) && !isHexId(eventId)) return eventId;
  const marketId = market.marketId.trim();
  if (marketId && !/^\d+$/.test(marketId) && !isHexId(marketId)) return marketId;
  return null;
}

function matchGammaMarket(
  event: PolymarketEventRecord,
  summary: PredictionMarketSummary,
): PolymarketMarketRecord | null {
  const markets = event.markets ?? [];
  const slug = extractPolymarketSlug(summary.url) ?? summary.marketId;
  const matched = markets.find((market) => {
    if (summary.conditionId && market.conditionId === summary.conditionId) return true;
    if (market.slug && (market.slug === summary.marketId || market.slug === slug)) return true;
    if (market.id && market.id === summary.marketId) return true;
    if (market.question === summary.title) return true;
    return false;
  });
  if (matched) return matched;
  return markets.length === 1 ? markets[0]! : null;
}

function applyPolymarketVenueStats(
  identity: PredictionMarketSummary,
  venue: PredictionMarketSummary,
): PredictionMarketSummary {
  return {
    ...identity,
    marketLabel: venue.marketLabel || identity.marketLabel,
    eventLabel: venue.eventLabel || identity.eventLabel,
    eventId: venue.eventId ?? identity.eventId,
    status: venue.status || identity.status,
    url: venue.url || identity.url,
    endsAt: venue.endsAt,
    updatedAt: venue.updatedAt,
    createdAt: venue.createdAt,
    yesPrice: venue.yesPrice,
    noPrice: venue.noPrice,
    yesBid: venue.yesBid,
    yesAsk: venue.yesAsk,
    noBid: venue.noBid,
    noAsk: venue.noAsk,
    spread: venue.spread,
    lastTradePrice: venue.lastTradePrice,
    volume24h: venue.volume24h,
    volume24hUnit: venue.volume24hUnit,
    totalVolume: venue.totalVolume,
    totalVolumeUnit: venue.totalVolumeUnit,
    openInterest: venue.openInterest,
    openInterestUnit: venue.openInterestUnit,
    liquidity: venue.liquidity,
    liquidityUnit: venue.liquidityUnit,
    yesTokenId: venue.yesTokenId ?? identity.yesTokenId,
    noTokenId: venue.noTokenId ?? identity.noTokenId,
    conditionId: identity.conditionId ?? venue.conditionId,
  };
}

function parseGammaEventPayload(raw: unknown): PolymarketEventRecord | null {
  const event = Array.isArray(raw) ? raw[0] : raw;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as PolymarketEventRecord;
  if (!record.id && !record.slug) return null;
  return record;
}

async function loadGammaEventBySlug(
  slug: string,
  signal?: AbortSignal,
): Promise<PolymarketEventRecord | null> {
  try {
    const raw = await fetchJson<unknown>(
      `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`,
      signal,
    );
    return parseGammaEventPayload(raw);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return null;
  }
}

/**
 * Adjacent search is identity only. Polymarket volume, OI, BBO, and close
 * come from Gamma by event slug, not Adjacent's public market list.
 */
export async function overlayGammaStatsOnPolymarketSearch(
  markets: PredictionMarketSummary[],
  signal?: AbortSignal,
): Promise<PredictionMarketSummary[]> {
  if (markets.length === 0) return markets;
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const market of markets) {
    if (market.venue !== "polymarket") continue;
    const slug = polymarketEventSlugForSummary(market);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
    if (slugs.length >= MAX_POLYMARKET_SEARCH_HYDRATE) break;
  }
  if (slugs.length === 0) return markets;

  const events = await Promise.all(
    slugs.map((slug) => loadGammaEventBySlug(slug, signal)),
  );
  const eventsBySlug = new Map<string, PolymarketEventRecord>();
  for (let index = 0; index < slugs.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    eventsBySlug.set(slugs[index]!, event);
    if (event.slug) eventsBySlug.set(event.slug, event);
    if (event.id) eventsBySlug.set(event.id, event);
  }
  if (eventsBySlug.size === 0) return markets;

  return markets.map((market) => {
    if (market.venue !== "polymarket") return market;
    const slug = polymarketEventSlugForSummary(market);
    const event = (slug ? eventsBySlug.get(slug) : undefined)
      ?? (market.eventId ? eventsBySlug.get(market.eventId) : undefined);
    if (!event) return market;
    const gammaMarket = matchGammaMarket(event, market);
    if (!gammaMarket) return market;
    const venue = normalizePolymarketMarket(
      hydratePolymarketMarket(gammaMarket, event),
      { catalog: true, keyOverride: market.key },
    );
    return venue ? applyPolymarketVenueStats(market, venue) : market;
  });
}
