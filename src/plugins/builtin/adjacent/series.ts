import type { AdjacentClient } from "./client";
import type { AdjacentPriceSample } from "./types";
import { normalizeAdjacentIndexPrices } from "./normalize";
import { adjacentPriceTier, adjacentPriceWindow } from "./price-window";
import type { TimeSeriesPoint } from "../../../time-series/types";
import type { UniversalSeriesLoadRequest, UniversalSeriesLoadResult } from "../../../time-series/resolve";

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
