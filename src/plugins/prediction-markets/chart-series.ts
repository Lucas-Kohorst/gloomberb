import type { TimeSeriesPoint } from "../../time-series/types";
import type { UniversalSeriesLoadResult } from "../../time-series/resolve";
import { getSharedAdjacentClient, type AdjacentClient } from "../builtin/adjacent/client";
import { normalizeAdjacentPriceHistory } from "../builtin/adjacent/normalize";
import type { AdjacentMarket } from "../builtin/adjacent/types";
import { loadVenuePredictionMarketSeries } from "./services/series";

function predictionYesPercent(value: number): number {
  return value <= 1 ? value * 100 : value;
}

function predictionMarketPoints(
  prices: Array<{ date: Date; close: number }>,
  providerId: string,
): TimeSeriesPoint[] {
  return prices.map((point) => ({
    date: point.date,
    observedAt: point.date,
    value: predictionYesPercent(point.close),
    provenance: { providerId, quality: "reported" },
  }));
}

function matchingPredictionMarket(
  markets: readonly AdjacentMarket[],
  venue: "kalshi" | "polymarket",
  marketId: string,
): AdjacentMarket | undefined {
  const needle = marketId.trim().toLowerCase();
  const venueMarkets = markets.filter((market) => market.platform === venue);
  const pool = venueMarkets;
  return pool.find((market) => {
    const id = market.id.trim().toLowerCase();
    const slug = market.slug?.trim().toLowerCase();
    return id === needle || slug === needle;
  });
}

export async function loadPredictionMarketSeries(
  venue: "kalshi" | "polymarket",
  marketId: string,
  sources: {
    loadVenue: typeof loadVenuePredictionMarketSeries;
    adjacent: Pick<AdjacentClient, "getMarketPrices" | "searchMarkets">;
  } = { loadVenue: loadVenuePredictionMarketSeries, adjacent: getSharedAdjacentClient() },
): Promise<UniversalSeriesLoadResult> {
  const venueSeries = await sources.loadVenue(venue, marketId)
    .catch(() => null);
  if (venueSeries) {
    return {
      points: predictionMarketPoints(venueSeries.points, venue),
      unit: "%",
      unitGroup: "probability",
      label: venueSeries.label,
    };
  }

  const client = sources.adjacent;
  const loadPrices = async (id: string) => {
    const response = await client.getMarketPrices(id);
    return normalizeAdjacentPriceHistory(response.prices ?? []);
  };

  let history = await loadPrices(marketId).catch(() => []);
  let label: string | undefined;
  if (history.length === 0) {
    const search = await client.searchMarkets(marketId, 8).catch(() => null);
    const match = matchingPredictionMarket(search?.markets ?? [], venue, marketId);
    if (!match) {
      throw new Error(
        `No ${venue} market found for "${marketId}" on ${venue === "kalshi" ? "Kalshi" : "Polymarket"} or Adjacent.`,
      );
    }
    history = await loadPrices(match.id);
    label = match.title;
    if (history.length === 0) {
      throw new Error(`No price history for ${venue} market "${match.title}".`);
    }
  }

  return {
    points: predictionMarketPoints(history, "adjacent"),
    unit: "%",
    unitGroup: "probability",
    label: label ?? `${venue === "kalshi" ? "KALSHI" : "POLY"} ${marketId}`,
  };
}
