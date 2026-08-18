import { getTimeSeriesField } from "./field-catalog";
import type { ChartSeriesSpec } from "./types";
import { publicTickerKey } from "../utils/exchanges";

/** Default legend label for a series source when the author left `label` blank. */
export function sourceFallbackLabel(source: ChartSeriesSpec["source"]): string {
  switch (source.kind) {
    case "economic":
      return `FRED ${source.seriesId}`;
    case "adjacent-index":
      return `ADJ ${source.indexId}`;
    case "benchmark":
      return `${source.selector} ${source.metric}`;
    case "poll":
      return `${source.subject} ${source.choice}`;
    case "prediction-market":
      return `${source.venue === "kalshi" ? "KALSHI" : "POLY"} ${source.marketId}`;
    case "constant":
      return String(source.value);
    default: {
      const instrument = publicTickerKey(source.instrument.symbol, source.instrument.exchange);
      const field = getTimeSeriesField(source.fieldId);
      return `${instrument} ${field?.shortLabel ?? source.fieldId.split(".").at(-1) ?? "Series"}`;
    }
  }
}
