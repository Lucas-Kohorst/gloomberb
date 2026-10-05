import { pricePointsToResolvedSeries } from "../../../components/chart/composite";
import { priceColor } from "../../../theme/colors";
import type { PricePoint } from "../../../types/financials";
import type { AdjacentClient } from "./client";
import type { AdjacentPriceSample } from "./types";
import { normalizeAdjacentIndexPrices } from "./normalize";
import { adjacentPriceTier, adjacentPriceWindow } from "./price-window";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import type { UniversalSeriesLoadRequest, UniversalSeriesLoadResult } from "../../../time-series/resolve";

/** Index and rate levels are a line on the right axis, colored by the window's change. */
export function adjacentLevelSeries(
  points: readonly PricePoint[],
  options: { id: string; label: string },
): ResolvedSeries {
  const first = points[0]?.close ?? 0;
  const last = points.at(-1)?.close ?? first;
  return pricePointsToResolvedSeries(points, {
    id: options.id,
    label: options.label,
    color: priceColor(last - first),
    unit: "index",
    unitGroup: "level",
    style: "line",
    axis: "right",
    panelId: "price",
    providerId: "adjacent",
  });
}

function samplesToSeries(samples: AdjacentPriceSample[]): UniversalSeriesLoadResult {
  const points: TimeSeriesPoint[] = normalizeAdjacentIndexPrices(samples).map((point) => ({
    date: point.date,
    observedAt: point.date,
    value: point.value,
    provenance: { providerId: "adjacent", quality: "reported" },
  }));
  return { points, unit: "index", unitGroup: "level" };
}

/** ADJ:id is an Adjacent index or a reference rate. Try index prices, then rates. */
export async function loadAdjacentChartSeries(
  client: Pick<AdjacentClient, "getIndexPrices" | "getRatePrices" | "requestApiKey">,
  id: string,
  request?: UniversalSeriesLoadRequest,
): Promise<UniversalSeriesLoadResult> {
  const window = request
    ? adjacentPriceWindow(
      request.range,
      adjacentPriceTier(client),
      { start: request.start ?? null, end: request.end ?? null },
    )
    : undefined;
  try {
    const index = await client.getIndexPrices(id, window);
    const series = samplesToSeries(index.data ?? []);
    if (series.points.length > 0) return series;
  } catch {
    // Rate ids share the ADJ: prefix.
  }
  const rate = await client.getRatePrices(id, window);
  return samplesToSeries(rate.data ?? []);
}
