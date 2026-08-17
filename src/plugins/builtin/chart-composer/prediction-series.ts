/**
 * Natural-language mapping onto prediction-market chart expressions.
 * Keeps the chart parser's prefix language (`KALSHI:`, `POLY:`, `ADJ:`) as the
 * source of truth: NL only recommends expressions that language already accepts.
 */

import {
  ADJACENT_INDEX_CATALOG,
  SERIES_PREFIX,
  findAdjacentIndexCatalogEntry,
  type AdjacentIndexCatalogEntry,
  type PredictionMarketVenue,
} from "./universal-series";

const PREDICTION_INTENT_WORDS = new Set([
  "kalshi",
  "polymarket",
  "poly",
  "prediction",
  "adjacent",
  "adj",
]);

const PREDICTION_PREFIX_RE = new RegExp(
  `^\\s*(${SERIES_PREFIX.kalshi}|${SERIES_PREFIX.polymarket}|${SERIES_PREFIX.predictionMarket}|${SERIES_PREFIX.adjacentIndex})\\s*:`,
  "i",
);

export interface PredictionMarketSearchHit {
  venue: PredictionMarketVenue;
  marketId: string;
  title: string;
  eventLabel?: string;
}

export type PredictionSeriesExpression =
  | { kind: "adjacent-index"; indexId: string; label?: string }
  | {
    kind: "prediction-market";
    venue: PredictionMarketVenue;
    marketId: string;
    label?: string;
  };

const MARKET_ID_RE = /^[A-Za-z0-9._:-]{1,160}$/;

export function normalizePredictionMarketId(
  venue: PredictionMarketVenue,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed || !MARKET_ID_RE.test(trimmed)) return null;
  return venue === "kalshi" ? trimmed.toUpperCase() : trimmed;
}

export function looksLikePredictionMarketQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (PREDICTION_PREFIX_RE.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((token) => PREDICTION_INTENT_WORDS.has(token))) return true;
  if (/\bfed\s+cuts?\b/.test(lower) || /\brate\s+cuts?\b/.test(lower)) return true;
  if (/\b(red|blue)\s+(index|idx)\b/.test(lower)) return true;
  if (/\bwill\b/.test(lower) && tokens.length >= 3) return true;
  return false;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function venueFromQuery(query: string): PredictionMarketVenue | null {
  const lower = query.toLowerCase();
  if (/\bkalshi\b/.test(lower)) return "kalshi";
  if (/\bpolymarket\b/.test(lower) || /\bpoly\b/.test(lower)) return "polymarket";
  return null;
}

function queryWithoutVenueWords(query: string): string {
  return query
    .replace(/\b(kalshi|polymarket|poly|prediction|markets?|adjacent|adj|index|idx|chart|graph)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function adjacentIndexScore(query: string, entry: AdjacentIndexCatalogEntry): number {
  const q = query.trim().toLowerCase();
  const qCompact = compact(q);
  if (!q) return -1;
  // Hyphenated tickers like RED-TR are unambiguous even without "index".
  if (q === entry.ticker.toLowerCase() && entry.ticker.includes("-")) {
    return 2_200 + qCompact.length;
  }
  const mentionsIndex = /\b(adjacent|adj|index|idx)\b/.test(q);
  if (!mentionsIndex) return -1;
  const keywords = [entry.indexId, entry.ticker, entry.name, ...entry.aliases];
  let best = -1;
  for (const keyword of keywords) {
    const kwCompact = compact(keyword);
    if (!kwCompact) continue;
    if (kwCompact === qCompact) best = Math.max(best, 2_000 + kwCompact.length);
    else if (qCompact.includes(kwCompact) && kwCompact.length >= 3) {
      best = Math.max(best, 1_200 + kwCompact.length);
    } else if (kwCompact.includes(qCompact) && qCompact.length >= 3) {
      best = Math.max(best, 1_000 + qCompact.length);
    }
  }
  const mentionsTicker = q.split(/[^a-z0-9]+/).some((token) => (
    token === entry.indexId || token === compact(entry.ticker)
  ));
  if (mentionsTicker) best = Math.max(best, 2_400);
  return best;
}

export function resolveAdjacentIndexQuery(query: string): PredictionSeriesExpression | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const exactTicker = findAdjacentIndexCatalogEntry(trimmed);
  if (exactTicker && trimmed.toLowerCase() === exactTicker.ticker.toLowerCase() && exactTicker.ticker.includes("-")) {
    return { kind: "adjacent-index", indexId: exactTicker.indexId, label: exactTicker.name };
  }
  let best: { entry: AdjacentIndexCatalogEntry; score: number } | null = null;
  for (const entry of ADJACENT_INDEX_CATALOG) {
    const score = adjacentIndexScore(trimmed, entry);
    if (score < 1_000) continue;
    if (!best || score > best.score) best = { entry, score };
  }
  if (!best) return null;
  return { kind: "adjacent-index", indexId: best.entry.indexId, label: best.entry.name };
}

function hitScore(query: string, hit: PredictionMarketSearchHit): number {
  const q = query.trim().toLowerCase();
  const qCompact = compact(queryWithoutVenueWords(query) || query);
  const haystack = compact([hit.marketId, hit.title, hit.eventLabel ?? ""].join(" "));
  const venue = venueFromQuery(query);
  let score = 0;
  if (venue && hit.venue !== venue) return -1;
  if (venue && hit.venue === venue) score += 400;
  if (haystack === qCompact) score += 2_000;
  else if (haystack.includes(qCompact) && qCompact.length >= 3) score += 1_200 + qCompact.length;
  else {
    const tokens = q.split(/[^a-z0-9]+/).filter((token) => (
      token.length >= 3 && !PREDICTION_INTENT_WORDS.has(token) && token !== "will"
    ));
    if (tokens.length === 0) return venue && hit.venue === venue ? score : -1;
    const matched = tokens.filter((token) => haystack.includes(compact(token)));
    if (matched.length === 0) return -1;
    score += 800 + matched.join("").length;
  }
  return score;
}

export function rankPredictionMarketHits(
  query: string,
  hits: readonly PredictionMarketSearchHit[],
): PredictionMarketSearchHit[] {
  return hits
    .map((hit) => ({ hit, score: hitScore(query, hit) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.hit);
}

/**
 * Maps a natural-language chart query onto the first series expression the
 * composer should fill. Prefix syntax wins; otherwise Adjacent index aliases
 * and ranked search hits (Kalshi/Polymarket) fill the gap.
 */
export function resolvePredictionSeriesQuery(
  query: string,
  searchedMarkets: readonly PredictionMarketSearchHit[] = [],
): PredictionSeriesExpression | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const adjacent = resolveAdjacentIndexQuery(trimmed);
  const ranked = rankPredictionMarketHits(trimmed, searchedMarkets);
  const venue = venueFromQuery(trimmed);
  if (venue && ranked[0]) {
    const marketId = normalizePredictionMarketId(ranked[0].venue, ranked[0].marketId);
    if (marketId) {
      return {
        kind: "prediction-market",
        venue: ranked[0].venue,
        marketId,
        label: ranked[0].title,
      };
    }
  }
  if (adjacent && !venue) return adjacent;
  if (ranked[0]) {
    const marketId = normalizePredictionMarketId(ranked[0].venue, ranked[0].marketId);
    if (marketId) {
      return {
        kind: "prediction-market",
        venue: ranked[0].venue,
        marketId,
        label: ranked[0].title,
      };
    }
  }
  return adjacent;
}

export function formatPredictionSeriesExpression(
  expression: PredictionSeriesExpression,
): string {
  if (expression.kind === "adjacent-index") {
    return `${SERIES_PREFIX.adjacentIndex}:${expression.indexId}`;
  }
  const prefix = expression.venue === "kalshi"
    ? SERIES_PREFIX.kalshi
    : SERIES_PREFIX.polymarket;
  return `${prefix}:${expression.marketId}`;
}
