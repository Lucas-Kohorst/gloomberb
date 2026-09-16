import { useState } from "react";
import type { ResultItem } from "../../list/model";
import {
  predictionCollectionSymbol,
} from "../../../../plugins/prediction-markets/collection-watchlist";
import { searchAdjacentCatalog } from "../../../../plugins/prediction-markets/services/adjacent-search";
import type { PredictionMarketSummary } from "../../../../plugins/prediction-markets/types";
import { useDebouncedAbortableEffect } from "./use-debounced-effect";

const PREDICTION_SEARCH_LIMIT = 5;
const MIN_QUERY_LENGTH = 3;

export function looksLikePredictionInstrumentQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return false;
  if (/^(KALSHI|POLY|PM)\s*:/i.test(trimmed)) return true;
  if (/^[A-Z]{1,5}$/i.test(trimmed)) return false;
  return /[a-z]{3,}/i.test(trimmed);
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hitScore(query: string, summary: PredictionMarketSummary): number {
  const q = compact(query);
  if (!q) return -1;
  const haystack = compact([
    summary.marketId,
    summary.title,
    summary.eventLabel,
    summary.marketLabel,
  ].join(" "));
  if (!haystack) return -1;
  if (haystack === q) return 2_000;
  if (haystack.includes(q)) return 1_200 + q.length;
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  const matched = tokens.filter((token) => haystack.includes(compact(token)));
  if (matched.length === 0) return -1;
  return 800 + matched.join("").length;
}

export async function searchPredictionInstruments(
  query: string,
  signal?: AbortSignal,
): Promise<PredictionMarketSummary[]> {
  const trimmed = query.trim();
  const empty = { markets: [] as PredictionMarketSummary[], hasMore: false, nextCursor: null };
  const [kalshiResult, polyResult] = await Promise.all([
    searchAdjacentCatalog({ query: trimmed, venue: "kalshi", page: 1, signal }).catch(() => empty),
    searchAdjacentCatalog({ query: trimmed, venue: "polymarket", page: 1, signal }).catch(() => empty),
  ]);
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

  const ranked = [...kalshiResult.markets, ...polyResult.markets]
    .map((summary) => ({ summary, score: hitScore(trimmed, summary) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => (
      right.score !== left.score
        ? right.score - left.score
        : (right.summary.volume24h ?? 0) - (left.summary.volume24h ?? 0)
    ));
  const kalshiHits = ranked.filter((entry) => entry.summary.venue === "kalshi");
  const polyHits = ranked.filter((entry) => entry.summary.venue === "polymarket");
  const mixed: PredictionMarketSummary[] = [];
  while (mixed.length < PREDICTION_SEARCH_LIMIT && (kalshiHits.length > 0 || polyHits.length > 0)) {
    const nextKalshi = kalshiHits.shift();
    if (nextKalshi) mixed.push(nextKalshi.summary);
    if (mixed.length >= PREDICTION_SEARCH_LIMIT) break;
    const nextPoly = polyHits.shift();
    if (nextPoly) mixed.push(nextPoly.summary);
  }
  return mixed;
}

export function usePredictionInstrumentSearch(query: string): {
  markets: PredictionMarketSummary[];
} {
  const [markets, setMarkets] = useState<PredictionMarketSummary[]>([]);

  useDebouncedAbortableEffect(
    query,
    looksLikePredictionInstrumentQuery(query),
    async (signal) => {
      try {
        const found = await searchPredictionInstruments(query, signal);
        if (signal.aborted) return;
        setMarkets(found);
      } catch {
        if (signal.aborted) return;
        setMarkets([]);
      }
    },
    { onDisable: () => setMarkets([]) },
  );

  return { markets };
}

export function buildPredictionMarketResultItems(options: {
  markets: readonly PredictionMarketSummary[];
  onOpen: (summary: PredictionMarketSummary) => void;
}): ResultItem[] {
  return options.markets.map((summary) => {
    const symbol = predictionCollectionSymbol(summary);
    return {
      id: `pm:${summary.key}`,
      label: symbol,
      detail: summary.title,
      category: "Instruments",
      kind: "search" as const,
      badge: "PM",
      searchText: `${symbol} ${summary.title} ${summary.eventLabel} kalshi polymarket prediction`,
      action: () => options.onOpen(summary),
    };
  });
}
