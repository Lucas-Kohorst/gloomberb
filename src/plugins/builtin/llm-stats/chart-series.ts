import type { TimeSeriesPoint } from "../../../time-series/types";
import type { UniversalSeriesLoadResult } from "../../../time-series/resolve";
import { fetchLlmStatsData } from "./client";
import type { LlmStatsRow } from "./types";
import { BENCHMARK_METRICS } from "./metrics";

const BENCHMARK_METRIC_FIELDS: Record<string, keyof LlmStatsRow> = {
  tps: "avgThroughput",
  p95: "p95Latency",
  ttft: "avgTtft",
  latency: "avgLatency",
  fail: "failureRate",
  calls: "totalCalls",
};

export async function loadBenchmarkSeries(
  selector: string,
  metric: string,
  loadData: typeof fetchLlmStatsData = fetchLlmStatsData,
): Promise<UniversalSeriesLoadResult> {
  const metricEntry = BENCHMARK_METRICS.find((entry) => entry.code === metric);
  const field = BENCHMARK_METRIC_FIELDS[metric];
  if (!metricEntry || !field) {
    throw new Error(`Unknown benchmark metric "${metric}".`);
  }
  const data = await loadData();
  const selectorLower = selector.trim().toLowerCase();
  const matching = data.rows.filter((row) =>
    row.organization.toLowerCase() === selectorLower
    || row.id.toLowerCase() === selectorLower
    || row.displayName.toLowerCase() === selectorLower,
  );
  if (matching.length === 0) {
    throw new Error(`No models found for "${selector}".`);
  }
  const points: TimeSeriesPoint[] = [];
  for (const row of matching) {
    if (!row.releaseDate) continue;
    const date = new Date(row.releaseDate);
    if (!Number.isFinite(date.getTime())) continue;
    const value = row[field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    points.push({
      date,
      observedAt: date,
      value,
      provenance: { providerId: "llm-stats", quality: "reported" },
    });
  }
  points.sort((left, right) => left.date.getTime() - right.date.getTime());
  return {
    points,
    unit: metricEntry.unit,
    unitGroup: `benchmark:${metric}`,
    label: `${selector} ${metricEntry.label}`,
    warning: matching.length === 1
      ? "Point-in-time snapshot at model release date; no historical time series available."
      : "Each point is a model's metric at its release date; no historical time series available.",
  };
}
