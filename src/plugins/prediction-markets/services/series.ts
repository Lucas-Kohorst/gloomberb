import type {
  PredictionHistoryPoint,
  PredictionMarketSummary,
  PredictionVenue,
} from "../types";
import { loadKalshiHistory, resolveKalshiMarketByTicker } from "./kalshi/adapter";
import {
  loadPolymarketHistory,
  resolvePolymarketMarketById,
} from "./polymarket/detail";

export interface VenuePredictionMarketSeries {
  points: PredictionHistoryPoint[];
  label: string;
  marketId: string;
  venue: PredictionVenue;
}

function seriesLabel(summary: PredictionMarketSummary): string {
  const target = summary.marketLabel?.trim();
  if (!target) return summary.title;
  if (summary.title.toLowerCase().includes(target.toLowerCase())) {
    return summary.title;
  }
  return `${summary.title} · ${target}`;
}

/**
 * Loads yes-price history for a venue-native market identifier. Chart specs
 * carry venue ids (Kalshi tickers, Gamma ids/slugs) rather than Adjacent market
 * ids, so charts must resolve against the venue itself before falling back to
 * Adjacent's own catalog.
 */
export async function loadVenuePredictionMarketSeries(
  venue: PredictionVenue,
  marketId: string,
): Promise<VenuePredictionMarketSeries | null> {
  const summary =
    venue === "kalshi"
      ? await resolveKalshiMarketByTicker(marketId)
      : await resolvePolymarketMarketById(marketId);
  if (!summary) return null;

  const points =
    venue === "kalshi"
      ? await loadKalshiHistory(summary, "ALL")
      : await loadPolymarketHistory(summary, "ALL");
  if (points.length === 0) return null;

  return {
    points,
    label: seriesLabel(summary),
    marketId: summary.marketId,
    venue,
  };
}
