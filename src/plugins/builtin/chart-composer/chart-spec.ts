import type { ChartSpec, ResolvedSeries } from "../../../time-series/types";
import { CHART_SPEC_VERSION } from "../../../time-series/types";
import {
  DEFAULT_CHART_SPEC,
  MAX_CHART_SERIES,
  normalizeChartSpec,
  validateChartSpec,
} from "../../../time-series/spec";

export const CHART_SPEC_SETTING_KEY = "chartSpec";
export const MAX_CHART_COMPOSER_SERIES = MAX_CHART_SERIES;

export function canToggleChartSeries(spec: ChartSpec, seriesId: string): boolean {
  const target = spec.series.find((series) => series.id === seriesId);
  if (!target) return false;
  if (target.visible === false) return true;
  return spec.series.filter((series) => series.visible !== false).length > 1;
}

export function toggleChartSeries(spec: ChartSpec, seriesId: string): ChartSpec {
  if (!canToggleChartSeries(spec, seriesId)) return spec;
  return {
    ...spec,
    series: spec.series.map((series) => series.id === seriesId
      ? { ...series, visible: series.visible === false }
      : series),
  };
}

export function canRemoveChartSeries(spec: ChartSpec, seriesId: string): boolean {
  return spec.series.length > 1 && spec.series.some((series) => series.id === seriesId);
}

export function removeChartSeries(spec: ChartSpec, seriesId: string): ChartSpec {
  if (!canRemoveChartSeries(spec, seriesId)) return spec;
  const series = spec.series.filter((entry) => entry.id !== seriesId);
  const seriesIds = new Set(series.map((entry) => entry.id));
  const studies = spec.studies.filter((study) => {
    const requiredInputs = study.kind === "ratio" || study.kind === "spread" || study.kind === "correlation" ? 2 : 1;
    return study.inputSeriesIds.length === requiredInputs
      && study.inputSeriesIds.every((id) => seriesIds.has(id));
  });
  const usedPanelIds = new Set([
    "main",
    ...series.map((entry) => entry.panelId),
    ...studies.map((study) => study.panelId),
  ]);
  const panels = spec.panels.filter((panel) => usedPanelIds.has(panel.id));
  if (!panels.some((panel) => panel.id === "main")) {
    panels.unshift({ id: "main" });
  }
  return { ...spec, series, studies, panels };
}

/**
 * Project the latest resolved data through the authored visibility immediately.
 * Resolution continues in the background, but hiding/restoring a loaded base
 * series should not wait for another provider round trip.
 */
export function projectVisibleChartSeries(
  spec: ChartSpec,
  resolvedSeries: readonly ResolvedSeries[],
  legendSeries: readonly ResolvedSeries[] = [],
): ResolvedSeries[] {
  const baseIds = new Set(spec.series.map((series) => series.id));
  const resolvedById = new Map([
    ...legendSeries.map((series) => [series.id, series] as const),
    ...resolvedSeries.map((series) => [series.id, series] as const),
  ]);
  return [
    ...spec.series.flatMap((series) => {
      const resolved = series.visible === false ? undefined : resolvedById.get(series.id);
      return resolved ? [resolved] : [];
    }),
    ...resolvedSeries.filter((series) => !baseIds.has(series.id)),
  ];
}

function decodeSpec(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse, migrate, normalize, and semantically validate a persisted chart spec. */
export function parseChartSpec(value: unknown): ChartSpec | null {
  const decoded = decodeSpec(value);
  if (!isRecord(decoded)) return null;
  if (decoded.version !== undefined && decoded.version !== CHART_SPEC_VERSION) return null;
  const spec = normalizeChartSpec(decoded, DEFAULT_CHART_SPEC);
  return validateChartSpec(spec).valid ? spec : null;
}

export function parseChartSpecOr(value: unknown, fallback: ChartSpec): ChartSpec {
  return parseChartSpec(value) ?? normalizeChartSpec(fallback, DEFAULT_CHART_SPEC);
}

export function serializeChartSpec(spec: ChartSpec): string {
  const normalized = normalizeChartSpec(spec, DEFAULT_CHART_SPEC);
  const validation = validateChartSpec(normalized);
  if (!validation.valid) {
    throw new Error(validation.errors.map((entry) => entry.message).join(" "));
  }
  return JSON.stringify(normalized);
}
