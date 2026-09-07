import type { UseChartResolutionResult } from "../../../time-series/use-chart-resolution";
import type { ChartSeriesSpec, ChartSpec, TimeSeriesPoint } from "../../../time-series/types";
import { publicTickerKey } from "../../../utils/exchanges";

function pointValue(point: TimeSeriesPoint | undefined): number | null {
  const value = point?.value ?? point?.close;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pointEvidence(point: TimeSeriesPoint | undefined) {
  if (!point) return null;
  const date = point.date instanceof Date ? point.date : new Date(point.date);
  return Number.isFinite(date.getTime())
    ? { date: date.toISOString(), value: pointValue(point) }
    : null;
}

function viewportEvidence(viewport: UseChartResolutionResult["viewport"]) {
  if (!viewport) return null;
  return {
    start: viewport.start.toISOString(),
    end: viewport.end.toISOString(),
    spanMs: viewport.end.getTime() - viewport.start.getTime(),
  };
}

function sourceEvidence(series: ChartSeriesSpec) {
  const source = series.source;
  switch (source.kind) {
    case "security":
      return {
        sourceKind: "security",
        symbol: publicTickerKey(source.instrument.symbol, source.instrument.exchange),
        exchange: source.instrument.exchange ?? null,
        fieldId: source.fieldId,
        period: source.period ?? "auto",
        timestampMode: source.timestampMode ?? null,
      };
    case "economic":
      return {
        sourceKind: "economic",
        provider: source.provider,
        economicSeriesId: source.seriesId,
      };
    case "capability":
      return {
        sourceKind: "capability",
        capabilityId: source.capabilityId,
        providerSeriesId: source.seriesId,
      };
    case "adjacent-index":
      return { sourceKind: "adjacent-index", indexId: source.indexId };
    case "benchmark":
      return { sourceKind: "benchmark", selector: source.selector, metric: source.metric };
    case "poll":
      return { sourceKind: "poll", subject: source.subject, choice: source.choice };
    case "weather":
      return {
        sourceKind: "weather",
        provider: source.provider,
        stationId: source.stationId,
        metric: source.metric,
      };
    case "owid":
      return { sourceKind: "owid", slug: source.slug, entity: source.entity };
    case "prediction-market":
      return { sourceKind: "prediction-market", venue: source.venue, marketId: source.marketId };
    case "constant":
      return { sourceKind: "constant", value: source.value };
  }
}

/** Stable semantic evidence used by desktop automation and bot-safe screenshots. */
export function chartComposerSemanticMetadata(
  spec: ChartSpec,
  resolution: UseChartResolutionResult,
  runtimeViewport?: { start: Date; end: Date } | null,
): Record<string, unknown> {
  const resolvedById = new Map(resolution.series.map((series) => [series.id, series] as const));
  const symbols = [...new Set(spec.series.flatMap((series) => (
    series.source.kind === "security"
      ? [publicTickerKey(series.source.instrument.symbol, series.source.instrument.exchange)]
      : []
  )))];
  const baseSeries = spec.series.map((series) => {
    const resolved = resolvedById.get(series.id);
    return {
      id: series.id,
      ...sourceEvidence(series),
      style: series.style,
      transform: series.transform,
      axis: resolved?.axis ?? series.axis,
      panelId: series.panelId,
      visible: series.visible !== false,
      pointCount: resolved?.points.length ?? 0,
      latestChangePercent: resolved?.latestChangePercent ?? null,
      first: pointEvidence(resolved?.points[0]),
      last: pointEvidence(resolved?.points.at(-1)),
    };
  });
  return {
    kind: "chart-composer",
    version: spec.version,
    symbols,
    rangePreset: spec.viewport.range,
    resolution: spec.viewport.resolution,
    dateWindow: spec.viewport.dateWindow ?? null,
    maxPoints: spec.viewport.maxPoints ?? null,
    loading: resolution.loading,
    errors: resolution.errors,
    warnings: resolution.warnings,
    resolutionSupport: resolution.resolutionSupport ?? null,
    viewport: viewportEvidence(runtimeViewport ?? resolution.viewport),
    authoredViewport: viewportEvidence(resolution.viewport),
    baseSeries,
    bufferedSeries: (resolution.bufferedSeries ?? []).map((series) => ({
      id: series.id,
      pointCount: series.points.length,
      first: pointEvidence(series.points[0]),
      last: pointEvidence(series.points.at(-1)),
    })),
    resolvedSeries: resolution.series.map((series) => ({
      id: series.id,
      label: series.label,
      style: series.style,
      transform: series.transform,
      axis: series.axis,
      panelId: series.panelId,
      timeBasis: series.timeBasis ?? null,
      pointCount: series.points.length,
      first: pointEvidence(series.points[0]),
      last: pointEvidence(series.points.at(-1)),
    })),
    projectedPointCount: Math.max(0, ...resolution.series.map((series) => series.points.length)),
  };
}
