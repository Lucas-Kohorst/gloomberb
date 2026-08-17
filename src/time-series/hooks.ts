import { useMemo } from "react";
import { apiClient } from "../api-client";
import { loadCachedFredSeries } from "../data/fred-series";
import { instrumentFromTicker } from "../market-data/request-types";
import { useAssetData } from "../plugins/runtime";
import { useAppSelector } from "../state/app/context";
import type { FredSeriesRequest } from "../data/fred-series";
import type { TickerRecord } from "../types/ticker";
import type { ChartSpec, TimeSeriesPoint } from "./types";
import {
  useChartResolution,
  type UseChartResolutionOptions,
  type UseChartResolutionResult,
} from "./use-chart-resolution";
import type { UniversalSeriesLoadResult } from "./resolve";
import {
  getSharedAdjacentClient,
} from "../plugins/builtin/adjacent/client";
import {
  normalizeAdjacentIndexPrices,
} from "../plugins/builtin/adjacent/normalize";
import { fetchLlmStatsData } from "../plugins/builtin/llm-stats/client";
import type { LlmStatsRow } from "../plugins/builtin/llm-stats/types";
import { fetchVoteHubPolls } from "../plugins/builtin/polls/client";
import {
  computePollTrend,
  normalizeVoteHubPoll,
} from "../plugins/builtin/polls/normalize";
import {
  BENCHMARK_METRICS,
} from "../plugins/builtin/chart-composer/universal-series";

async function loadFred(request: FredSeriesRequest) {
  return loadCachedFredSeries(
    request,
    () => apiClient.getCloudFredSeries(request.seriesId, {
      startDate: request.startDate,
      sortOrder: request.sortOrder,
    }),
  );
}

export async function loadAdjacentIndexSeries(indexId: string): Promise<UniversalSeriesLoadResult> {
  const client = getSharedAdjacentClient();
  const response = await client.getIndexPrices(indexId);
  const pricePoints = normalizeAdjacentIndexPrices(response.data ?? []);
  const points: TimeSeriesPoint[] = pricePoints.map((point) => ({
    date: point.date,
    observedAt: point.date,
    value: point.value,
    provenance: { providerId: "adjacent", quality: "reported" },
  }));
  return {
    points,
    unit: "index",
    unitGroup: `adjacent-index:${indexId}`,
  };
}

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
): Promise<UniversalSeriesLoadResult> {
  const metricEntry = BENCHMARK_METRICS.find((entry) => entry.code === metric);
  const field = BENCHMARK_METRIC_FIELDS[metric];
  if (!metricEntry || !field) {
    throw new Error(`Unknown benchmark metric "${metric}".`);
  }
  const data = await fetchLlmStatsData();
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

export async function loadPollSeries(
  subject: string,
  choice: string,
): Promise<UniversalSeriesLoadResult> {
  const polls = await fetchVoteHubPolls({ subject });
  const rows = polls.map(normalizeVoteHubPoll);
  const trend = computePollTrend(rows, subject, choice);
  const points: TimeSeriesPoint[] = trend.map((point) => {
    const date = new Date(`${point.date}T00:00:00Z`);
    return {
      date: Number.isFinite(date.getTime()) ? date : new Date(point.date),
      observedAt: Number.isFinite(date.getTime()) ? date : new Date(point.date),
      value: point.value,
      provenance: { providerId: "votehub", quality: "reported" },
    };
  });
  return {
    points,
    unit: "%",
    unitGroup: `poll:${subject}`,
    label: `${subject} ${choice}`,
  };
}

export function hydrateChartSpecInstruments(
  spec: ChartSpec,
  tickers: ReadonlyMap<string, TickerRecord>,
): ChartSpec {
  let changed = false;
  const series = spec.series.map((entry) => {
    if (entry.source.kind !== "security" || entry.source.instrument.exchange?.trim()) {
      return entry;
    }
    const symbol = entry.source.instrument.symbol.trim().toUpperCase();
    const instrument = instrumentFromTicker(tickers.get(symbol), symbol);
    if (!instrument?.exchange) return entry;
    changed = true;
    return {
      ...entry,
      source: {
        ...entry.source,
        instrument: {
          ...instrument,
          ...entry.source.instrument,
          exchange: instrument.exchange,
        },
      },
    };
  });
  return changed ? { ...spec, series } : spec;
}

export function useResolvedChartSpec(
  spec: ChartSpec,
  options: UseChartResolutionOptions = {},
): UseChartResolutionResult {
  const dataProvider = useAssetData();
  const tickers = useAppSelector((state) => state.tickers);
  const hydratedSpec = useMemo(
    () => hydrateChartSpecInstruments(spec, tickers),
    [spec, tickers],
  );
  const sources = useMemo(
    () => ({
      dataProvider,
      loadFredSeries: loadFred,
      loadAdjacentIndexSeries,
      loadBenchmarkSeries,
      loadPollSeries,
    }),
    [dataProvider],
  );
  return useChartResolution(hydratedSpec, sources, options);
}
