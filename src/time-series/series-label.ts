import { getTimeSeriesField } from "./field-catalog";
import type { ChartSeriesSpec } from "./types";
import { publicTickerKey } from "../utils/exchanges";

/** Default legend label for a series source when the author left `label` blank. */
export function sourceFallbackLabel(source: ChartSeriesSpec["source"]): string {
  switch (source.kind) {
    case "economic":
      return `FRED ${source.seriesId}`.trim() || "FRED series";
    case "adjacent-index":
      return `ADJ ${source.indexId}`.trim() || "Adjacent index";
    case "benchmark":
      return `${source.selector} ${source.metric}`.trim() || "Benchmark";
    case "poll":
      return `${source.subject} ${source.choice}`.trim() || "Poll";
    case "weather":
      return `${source.provider === "nws-cli" ? "NWS" : "WX"} ${source.stationId} ${source.metric}`.trim() || "Weather";
    case "owid":
      return `OWID ${source.slug} ${source.entity}`.trim() || "OWID series";
    case "prediction-market":
      return `${source.venue === "kalshi" ? "KALSHI" : "POLY"} ${source.marketId}`.trim() || "Prediction market";
    case "constant":
      return String(source.value);
    default: {
      const instrument = publicTickerKey(source.instrument.symbol, source.instrument.exchange).trim();
      const field = getTimeSeriesField(source.fieldId);
      const fieldLabel = field?.shortLabel ?? source.fieldId.split(".").at(-1) ?? "Series";
      return `${instrument} ${fieldLabel}`.trim() || "Series";
    }
  }
}

/** Authored label, else the source default. Never blank. */
export function seriesSpecLabel(
  spec: Pick<ChartSeriesSpec, "label" | "source">,
  ...candidates: Array<string | undefined>
): string {
  for (const candidate of [spec.label, ...candidates]) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return sourceFallbackLabel(spec.source).trim() || "Series";
}
