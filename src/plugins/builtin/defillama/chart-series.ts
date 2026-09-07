import { chartSeriesProvider } from "../../../capabilities";
import { colors } from "../../../theme/colors";
import type { ResolvedSeries } from "../../../time-series/types";
import { loadDefiLlamaSeries } from "../../../sources/defillama/client";
import { DEFILLAMA_CAPABILITY_ID, DEFILLAMA_CATALOG, parseDefiLlamaSeriesId } from "./catalog";

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

export const defillamaChartCapability = chartSeriesProvider({
  id: DEFILLAMA_CAPABILITY_ID,
  name: "DefiLlama",
  provider: {
    async catalog({ query, limit }) {
      const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return DEFILLAMA_CATALOG.filter((entry) => words.every((word) =>
        `${entry.label} ${entry.expression} defillama defi total value locked`.toLowerCase().includes(word),
      )).slice(0, limit ?? 8).map(({ seriesId, label }) => ({
        seriesId, label, description: "DefiLlama free API · daily USD observations", detail: "DefiLlama",
      }));
    },
    resolve: ({ seriesId }) => resolveDefiLlamaChartSeries(seriesId),
  },
});
