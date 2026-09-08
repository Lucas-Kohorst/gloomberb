import { colors } from "../../../theme/colors";
import type { ResolvedSeries } from "../../../time-series/types";
import { loadDefiLlamaSeries } from "../../../sources/defillama/client";
import { parseDefiLlamaSeriesId } from "./catalog";

export async function resolveDefiLlamaChartSeries(seriesId: string): Promise<ResolvedSeries> {
  const identity = parseDefiLlamaSeriesId(seriesId);
  if (!identity) throw new Error("Use LLAMA:chain:ethereum:tvl or LLAMA:protocol:aave:tvl (protocols also support fees/revenue).");
  const data = await loadDefiLlamaSeries(identity.kind, identity.slug, identity.metric);
  return {
    id: `defillama:${seriesId}`,
    label: data.label ?? seriesId,
    color: colors.textBright,
    unit: "USD",
    unitGroup: "currency-total:USD",
    nativeFrequency: "daily",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    points: data.points,
    ...(data.warning ? { warning: data.warning } : {}),
  };
}
