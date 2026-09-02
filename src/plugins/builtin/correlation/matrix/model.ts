import { colors } from "../../../../theme/colors";
import type { ResolvedSeries } from "../../../../time-series/types";
import { parseSeriesExpression } from "../../chart-composer/presets";
import {
  computeDatedReturns,
  correlateDatedReturns,
  dailyClosesFromObservations,
  type CorrelationResult,
  type DatedReturn,
} from "../compute";
import type { CorrelationRangePreset } from "../settings";

export const ROW_HEADER_WIDTH = 7;
export const MATRIX_CELL_WIDTH = 10;
export const MIN_MATRIX_CELL_WIDTH = 7;
const MIN_CORRELATION_OBSERVATIONS = 5;

export type SeriesStatus = "loading" | "ready" | "insufficient" | "empty" | "error";

export interface CorrelationSeries {
  symbol: string;
  returns: DatedReturn[];
  status: SeriesStatus;
  observationCount: number;
}

export function displaySymbol(symbol: string): string {
  const parsed = parseSeriesExpression(symbol);
  const label = parsed?.kind === "prediction-market"
    ? parsed.marketId
    : parsed?.kind === "adjacent-index"
      ? parsed.indexId.toUpperCase()
      : symbol;
  return label.length > 8 ? label.slice(0, 8) : label;
}

export function pairKey(left: string, right: string): string {
  return `${left}\u0000${right}`;
}

function formatSymbolList(symbols: string[]): string {
  if (symbols.length <= 3) return symbols.join(", ");
  return `${symbols.slice(0, 3).join(", ")} +${symbols.length - 3}`;
}

function formatSeriesSymbolList(symbols: string[], seriesBySymbol: Map<string, CorrelationSeries>, includeCounts = false): string {
  return formatSymbolList(symbols.map((symbol) => {
    const series = seriesBySymbol.get(symbol);
    return includeCounts && series ? `${symbol}(${series.observationCount})` : symbol;
  }));
}

export function getSeriesForResolvedSeries(
  symbol: string,
  resolved: ResolvedSeries | undefined,
  loading: boolean,
): CorrelationSeries {
  const priceHistory = resolved
    ? dailyClosesFromObservations(resolved.points)
    : [];

  if (priceHistory.length === 0) {
    if (resolved?.error) {
      return { symbol, returns: [], status: "error", observationCount: 0 };
    }
    if (loading) {
      return { symbol, returns: [], status: "loading", observationCount: 0 };
    }
    return { symbol, returns: [], status: "empty", observationCount: 0 };
  }

  const returns = computeDatedReturns(priceHistory);
  if (returns.length < MIN_CORRELATION_OBSERVATIONS) {
    return {
      symbol,
      returns,
      status: "insufficient",
      observationCount: returns.length,
    };
  }

  return { symbol, returns, status: "ready", observationCount: returns.length };
}

export function rowHeaderColor(status: SeriesStatus): string {
  switch (status) {
    case "loading":
      return colors.textDim;
    case "error":
    case "empty":
      return colors.negative;
    case "insufficient":
      return colors.textMuted;
    case "ready":
      return colors.textBright;
  }
}

export function buildCorrelationMatrix(
  symbols: string[],
  seriesBySymbol: Map<string, CorrelationSeries>,
): {
  results: Map<string, CorrelationResult>;
  sampleMin: number | null;
  sampleMax: number | null;
  hasThinPair: boolean;
} {
  const results = new Map<string, CorrelationResult>();
  const sampleSizes: number[] = [];
  let hasThinPair = false;

  for (let rowIndex = 0; rowIndex < symbols.length; rowIndex++) {
    for (let colIndex = 0; colIndex < symbols.length; colIndex++) {
      if (rowIndex === colIndex) continue;
      const rowSym = symbols[rowIndex]!;
      const colSym = symbols[colIndex]!;
      const rowSeries = seriesBySymbol.get(rowSym);
      const colSeries = seriesBySymbol.get(colSym);
      const result = rowSeries && colSeries
        ? correlateDatedReturns(rowSeries.returns, colSeries.returns, MIN_CORRELATION_OBSERVATIONS)
        : { correlation: null, sampleSize: 0 };
      results.set(pairKey(rowSym, colSym), result);
      if (rowIndex < colIndex) {
        if (result.sampleSize > 0) sampleSizes.push(result.sampleSize);
        if (result.correlation == null && result.sampleSize < MIN_CORRELATION_OBSERVATIONS) {
          hasThinPair = true;
        }
      }
    }
  }

  return {
    results,
    sampleMin: sampleSizes.length > 0 ? Math.min(...sampleSizes) : null,
    sampleMax: sampleSizes.length > 0 ? Math.max(...sampleSizes) : null,
    hasThinPair,
  };
}

export function buildStatusSummary(
  symbols: string[],
  seriesBySymbol: Map<string, CorrelationSeries>,
  sampleMin: number | null,
  sampleMax: number | null,
  hasThinPair = false,
): string {
  const parts: string[] = [];
  const byStatus = (status: SeriesStatus) => symbols.filter((symbol) => seriesBySymbol.get(symbol)?.status === status);

  const loading = byStatus("loading");
  const errors = [...byStatus("error"), ...byStatus("empty")];
  const insufficient = byStatus("insufficient");

  if (loading.length > 0) parts.push(`Loading: ${formatSeriesSymbolList(loading, seriesBySymbol)}`);
  if (errors.length > 0) parts.push(`No data: ${formatSeriesSymbolList(errors, seriesBySymbol)}`);
  if (insufficient.length > 0) parts.push(`Need history: ${formatSeriesSymbolList(insufficient, seriesBySymbol, true)}`);

  if (sampleMin != null && sampleMax != null) {
    parts.push(sampleMin === sampleMax ? `obs ${sampleMin}` : `obs ${sampleMin}-${sampleMax}`);
  } else if (symbols.length >= 2) {
    parts.push("No paired dates yet");
  }

  // Only legend the blank cells when at least one pair actually has too few
  // shared dates to correlate.
  if (hasThinPair) parts.push(`- <${MIN_CORRELATION_OBSERVATIONS} shared`);
  return parts.join(" · ");
}

/**
 * The matrix already labels every symbol on both axes and the pane now carries
 * its own range control, so the title stays generic instead of repeating them.
 */
export function buildCorrelationPaneTitle(): string {
  return "Correlation";
}
