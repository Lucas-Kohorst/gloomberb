import type { UniversalSeriesLoadResult } from "../../../time-series/resolve";
import { loadWeatherSeries as loadTwcWeatherSeries } from "./client";
import { loadNwsCliSeries } from "./nws-client";

export async function loadWeatherSeries(
  provider: "twc-kalshi" | "nws-cli",
  stationId: string,
  metric: "high" | "low" | "precip" | "hourly",
): Promise<UniversalSeriesLoadResult> {
  const loaded = provider === "nws-cli"
    ? await loadNwsCliSeries(stationId, metric)
    : await loadTwcWeatherSeries(stationId, metric);
  return {
    points: loaded.points.map((point) => ({
      date: point.date,
      observedAt: point.date,
      value: point.value,
      provenance: {
        providerId: provider,
        quality: "reported",
      },
    })),
    label: loaded.label,
    unit: loaded.unit,
    unitGroup: loaded.unitGroup,
  };
}
