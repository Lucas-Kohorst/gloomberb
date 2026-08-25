import type { ChartSpec } from "../../../time-series/types";
import type { TimeRange } from "../../../components/chart/core/types";
import { buildCustomChartPreset, parseSeriesExpression } from "../chart-composer/presets";
import { formatParsedSeriesExpression } from "../chart-composer/series-catalog";
import { publicTickerKey } from "../../../utils/exchanges";
import { MAX_TICKER_LIST_SIZE } from "../../../tickers/list";

export const MAX_CORRELATION_SYMBOLS = MAX_TICKER_LIST_SIZE;

const UNSUPPORTED_SERIES_MESSAGE =
  "CORR supports tickers and prediction-market series (POLY:, KALSHI:, ADJ:).";

export function isCorrelationPredictionSeries(symbol: string): boolean {
  const parsed = parseSeriesExpression(symbol);
  return parsed?.kind === "prediction-market" || parsed?.kind === "adjacent-index";
}

export function canonicalizeCorrelationSymbol(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Enter at least one ticker or prediction-market series.");
  }
  const parsed = parseSeriesExpression(trimmed);
  if (!parsed) {
    return trimmed.toUpperCase();
  }
  if (parsed.kind === "prediction-market" || parsed.kind === "adjacent-index") {
    return formatParsedSeriesExpression(parsed);
  }
  if (parsed.kind === "security") {
    return publicTickerKey(parsed.symbol, parsed.exchange);
  }
  throw new Error(`${UNSUPPORTED_SERIES_MESSAGE} Not "${trimmed}".`);
}

export function parseCorrelationSymbolsInput(
  raw: string,
  maxSymbols = MAX_CORRELATION_SYMBOLS,
): string[] {
  const tokens = raw
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter(Boolean);

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const canonical = canonicalizeCorrelationSymbol(token);
    const key = canonical.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(canonical);
  }

  if (unique.length === 0) {
    throw new Error("Enter at least one ticker or prediction-market series.");
  }
  if (unique.length > maxSymbols) {
    throw new Error(`You can compare up to ${maxSymbols} series.`);
  }
  return unique;
}

export function buildCorrelationChartSpec(
  symbols: string[],
  range: TimeRange,
): ChartSpec {
  const spec = buildCustomChartPreset(symbols.join(", "));
  return {
    ...spec,
    viewport: {
      range,
      resolution: "1d",
    },
  };
}
