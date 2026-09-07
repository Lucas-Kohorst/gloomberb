import type { ChartSeriesSpec, ChartSpec } from "../../../time-series/types";
import { MAX_CHART_COMPOSER_SERIES } from "./chart-spec";
import { appendChartSeries, applyChartIdeaToSpec, type ChartIdeaApplyResult } from "./presets";
import { formatParsedSeriesExpression, type SeriesCatalogSuggestion } from "./series-catalog";

export type CatalogCommitResult =
  | { kind: "idea"; spec: ChartSpec; appended: ChartSeriesSpec[] }
  | { kind: "append"; spec: ChartSpec; series: ChartSeriesSpec }
  | { kind: "limit"; message: string }
  | null;

const LIMIT_MESSAGE = `Charts support up to ${MAX_CHART_COMPOSER_SERIES} base series.`;

/**
 * Resolves a catalog suggestion into either a multi-leg idea merge, a plain
 * single-series append, or a limit error — without touching component state.
 * Shared by the inline quick-add widget and the series editor controller so
 * both apply ideas and enforce the series cap identically.
 */
export function resolveCatalogSuggestion(
  suggestion: SeriesCatalogSuggestion | undefined,
  spec: ChartSpec,
): CatalogCommitResult {
  if (!suggestion) return null;

  const expressionText = suggestion.expressionText;
  const idea: ChartIdeaApplyResult | null = expressionText
    && expressionText !== formatParsedSeriesExpression(suggestion.expression)
    ? applyChartIdeaToSpec(spec, expressionText)
    : null;

  if (idea) {
    if (spec.series.length + idea.appended.length > MAX_CHART_COMPOSER_SERIES) {
      return { kind: "limit", message: LIMIT_MESSAGE };
    }
    return { kind: "idea", spec: idea.spec, appended: idea.appended };
  }

  if (spec.series.length >= MAX_CHART_COMPOSER_SERIES) {
    return { kind: "limit", message: LIMIT_MESSAGE };
  }

  const appended = appendChartSeries(spec, suggestion.expression);
  return { kind: "append", spec: appended.spec, series: appended.series };
}

/**
 * Arms a one-microtask commit lock so a double-submit (Enter + click, or
 * onChange echoing a programmatic clear) cannot apply the same suggestion
 * twice. The ref is set synchronously and cleared on the next microtask.
 */
export function armCommitLock(lockRef: { current: boolean }): void {
  lockRef.current = true;
  queueMicrotask(() => {
    lockRef.current = false;
  });
}
