import { stubSummaryFromWatchlistKey } from "./collection-watchlist";
import type { PredictionMarketSummary } from "./types";

type WatchlistMarket = Pick<PredictionMarketSummary, "key" | "title" | "url"> &
  Partial<Pick<PredictionMarketSummary, "eventId" | "eventTicker" | "eventLabel" | "marketLabel">>;

export interface PredictionWatchlistState {
  keys: string[];
  markets: WatchlistMarket[];
}

export function createPredictionWatchlistState(
  keys: string[],
  snapshots: PredictionMarketSummary[],
): PredictionWatchlistState {
  const selected = new Set(keys);
  return {
    keys,
    markets: snapshots.filter((market) => selected.has(market.key)).map((market) => ({
      key: market.key,
      title: market.title,
      url: market.url,
      ...(market.eventId ? { eventId: market.eventId } : {}),
      ...(market.eventTicker ? { eventTicker: market.eventTicker } : {}),
      ...(market.eventLabel !== market.title ? { eventLabel: market.eventLabel } : {}),
      ...(market.marketLabel !== market.title ? { marketLabel: market.marketLabel } : {}),
    })),
  };
}

export function restorePredictionWatchlistSnapshots(
  state: PredictionWatchlistState,
): PredictionMarketSummary[] {
  return state.markets.flatMap((market) => {
    const stub = stubSummaryFromWatchlistKey(market.key);
    return stub ? [{
      ...stub,
      ...market,
      eventLabel: market.eventLabel ?? market.title,
      marketLabel: market.marketLabel ?? market.title,
    }] : [];
  });
}
