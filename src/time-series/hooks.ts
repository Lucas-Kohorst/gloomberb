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
  normalizeAdjacentPriceHistory,
} from "../plugins/builtin/adjacent/normalize";
import type { AdjacentMarket } from "../plugins/builtin/adjacent/types";
import { loadVenuePredictionMarketSeries } from "../plugins/prediction-markets/services/series";
import { fetchLlmStatsData } from "../plugins/builtin/llm-stats/client";
import type { LlmStatsRow } from "../plugins/builtin/llm-stats/types";
import { fetchVoteHubPolls } from "../plugins/builtin/polls/client";
import {
  computePollTrend,
  normalizeVoteHubPoll,
} from "../plugins/builtin/polls/normalize";
import { loadWeatherSeries as loadTwcWeatherSeries } from "../plugins/builtin/weather/client";
import { loadNwsCliSeries } from "../plugins/builtin/weather/nws-client";
import { fetchOwidChart } from "../plugins/builtin/owid/client";
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
    unitGroup: "level",
  };
}

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
  const pool = venueMarkets.length > 0 ? venueMarkets : markets;
  return pool.find((market) => {
    const id = market.id.trim().toLowerCase();
    const slug = market.slug?.trim().toLowerCase();
    return id === needle || slug === needle;
  }) ?? pool[0];
}

export async function loadPredictionMarketSeries(
  venue: "kalshi" | "polymarket",
  marketId: string,
): Promise<UniversalSeriesLoadResult> {
  const venueSeries = await loadVenuePredictionMarketSeries(venue, marketId)
    .catch(() => null);
  if (venueSeries) {
    return {
      points: predictionMarketPoints(venueSeries.points, venue),
      unit: "%",
      unitGroup: "probability",
      label: venueSeries.label,
    };
  }

  const client = getSharedAdjacentClient();
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
    unitGroup: "percent",
    label: `${subject} ${choice}`,
  };
}

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

function owidObservationDate(time: string, timeKind: "year" | "day"): Date | null {
  if (timeKind === "year") {
    const year = Number(time);
    if (!Number.isInteger(year) || year < 1) return null;
    return new Date(Date.UTC(year, 0, 1));
  }
  const parsed = new Date(`${time}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function loadOwidSeries(
  slug: string,
  entity: string,
): Promise<UniversalSeriesLoadResult> {
  const print = await fetchOwidChart(slug, entity);
  const points: TimeSeriesPoint[] = [];
  for (const row of print.observations) {
    if (row.value == null) continue;
    const date = owidObservationDate(row.time, print.timeKind);
    if (!date) continue;
    points.push({
      date,
      observedAt: date,
      value: row.value,
      provenance: { providerId: "owid", quality: "reported" },
    });
  }
  points.sort((left, right) => left.date.getTime() - right.date.getTime());
  const entityLabel = print.entity?.name ?? entity;
  return {
    points,
    unit: print.unit ?? "",
    unitGroup: `owid:${print.slug}`,
    label: print.columnTitle
      ? `${print.columnTitle} · ${entityLabel}`
      : `${print.title} · ${entityLabel}`,
    warning: print.citation ? `${print.license}. ${print.citation}` : print.license,
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
      loadWeatherSeries,
      loadOwidSeries,
      loadPredictionMarketSeries,
    }),
    [dataProvider],
  );
  return useChartResolution(hydratedSpec, sources, options);
}
