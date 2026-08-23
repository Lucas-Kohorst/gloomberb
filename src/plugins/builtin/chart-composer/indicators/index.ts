/**
 * Technical indicator library — renderer-neutral, pure math.
 *
 * Each indicator is a pure function over OHLCV bars that returns one or more
 * named output series (`IndicatorOutput`). The library owns no chart/UI state;
 * the chart-composer study pipeline consumes these functions to render overlays
 * and sub-panel oscillators, and tests assert the math against hand-computed
 * values.
 *
 * The OHLCV input reuses the existing {@link PricePoint} shape (date + OHLCV
 * fields) so indicators compose with the rest of the market-data pipeline
 * without an adapter layer.
 */

import type { PricePoint } from "../../../../types/financials";

import { definition as sma } from "./sma";
import { definition as ema } from "./ema";
import { definition as rsi } from "./rsi";
import { definition as macd } from "./macd";
import { definition as bollinger } from "./bollinger";
import { definition as vwap } from "./vwap";
import { definition as atr } from "./atr";
import { definition as stochastic } from "./stochastic";
import { definition as adx } from "./adx";

/** OHLCV bar, aliased from the shared market-data price point. */
export type OHLCV = PricePoint;

/** A single named output time series aligned to input bar timestamps. */
export interface IndicatorSeries {
  /** Epoch-millis timestamp for each value (one per input bar). */
  timestamps: number[];
  /** Computed value, or `null` during the indicator warmup window. */
  values: (number | null)[];
}

/** All outputs of an indicator, keyed by output name (e.g. `upper`, `macd`). */
export type IndicatorOutput = Record<string, IndicatorSeries>;

/** Indicator parameter map (periods, deviations, smoothing, …). */
export type IndicatorParams = Record<string, number>;

/** Pure indicator function: OHLCV + params → named output series. */
export type IndicatorFn = (data: OHLCV[], params: IndicatorParams) => IndicatorOutput;

/** Where an indicator draws: over the price pane or in a sub-panel. */
export type IndicatorPane = "overlay" | "sub";

export interface IndicatorDefinition {
  /** Stable lowercase id used in `IND:` expressions and the registry. */
  id: string;
  label: string;
  description: string;
  defaultParams: IndicatorParams;
  /** Output names this indicator produces, in display order. */
  outputs: string[];
  pane: IndicatorPane;
  apply: IndicatorFn;
}

// ---------------------------------------------------------------------------
// Shared math helpers (used by the individual indicator modules).
// ---------------------------------------------------------------------------

/** True for a real, finite number (filters NaN/Infinity and non-numbers). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Coerce to a positive integer, falling back when absent or invalid. */
export function positiveInt(value: number | undefined, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

/**
 * Simple moving average aligned to the input: `null` until `period` values are
 * available, then the arithmetic mean of the trailing `period` values. `NaN`
 * entries mark missing bars — any window containing one yields `null` so gaps
 * don't silently pull the average toward zero.
 */
export function smaArray(values: readonly number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return result;
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < values.length; i += 1) {
    const entering = values[i]!;
    if (!Number.isNaN(entering)) {
      sum += entering;
      valid += 1;
    }
    if (i >= period) {
      const leaving = values[i - period]!;
      if (!Number.isNaN(leaving)) {
        sum -= leaving;
        valid -= 1;
      }
    }
    if (i >= period - 1 && valid === period) result[i] = sum / period;
  }
  return result;
}

/**
 * Exponential moving average aligned to the input. Seeded with the SMA of the
 * first `period` consecutive valid values, then recursively smoothed with
 * `k = 2 / (period + 1)`. Missing (`NaN`) bars are skipped: the EMA carries its
 * previous value forward to the next valid bar and is `null` on the gap bar.
 */
export function emaArray(values: readonly number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return result;
  // Find the first run of `period` consecutive valid values to seed on.
  let run = 0;
  let seedEnd = -1;
  let seedSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (Number.isNaN(values[i])) {
      run = 0;
      seedSum = 0;
      continue;
    }
    run += 1;
    seedSum += values[i]!;
    if (run === period) {
      seedEnd = i;
      break;
    }
  }
  if (seedEnd < 0) return result;
  let current = seedSum / period;
  result[seedEnd] = current;
  const k = 2 / (period + 1);
  for (let i = seedEnd + 1; i < values.length; i += 1) {
    if (Number.isNaN(values[i])) continue;
    current = values[i]! * k + current * (1 - k);
    result[i] = current;
  }
  return result;
}

/**
 * Wilder smoothing (the RSI/ATR/ADX recursive average). Seeded with the simple
 * average of the first `period` valid values at or after `startIndex`, then
 * each later valid value is `(prev * (period - 1) + next) / period`. Missing
 * (`NaN`) entries are skipped and produce `null`. Returns an aligned array.
 */
export function wilderSmooth(
  values: readonly number[],
  period: number,
  startIndex = 0,
): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return result;
  let run = 0;
  let seedSum = 0;
  let seedIndex = -1;
  for (let i = startIndex; i < values.length; i += 1) {
    if (Number.isNaN(values[i])) continue;
    run += 1;
    seedSum += values[i]!;
    if (run === period) {
      seedIndex = i;
      break;
    }
  }
  if (seedIndex < 0) return result;
  let average = seedSum / period;
  result[seedIndex] = average;
  for (let i = seedIndex + 1; i < values.length; i += 1) {
    if (Number.isNaN(values[i])) continue;
    average = (average * (period - 1) + values[i]!) / period;
    result[i] = average;
  }
  return result;
}

/** Standard deviation (population) of a window of values. */
export function stddev(values: readonly number[], mean: number): number {
  if (values.length === 0) return 0;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  return Math.sqrt(variance / values.length);
}

/** Extract the close price used by most indicators, or `null` when missing. */
export function closePrice(bar: OHLCV): number | null {
  return isFiniteNumber(bar.close) ? bar.close : null;
}

/**
 * True range for bar `i`: the greatest of high−low, |high−prevClose|, and
 * |low−prevClose|. The first bar (no previous close) uses high−low. Missing
 * high/low yields `NaN`. Shared by ATR and ADX.
 */
export function trueRange(bars: readonly OHLCV[], i: number): number {
  const bar = bars[i]!;
  if (!isFiniteNumber(bar.high) || !isFiniteNumber(bar.low)) return Number.NaN;
  const highLow = bar.high - bar.low;
  if (i === 0) return highLow;
  const prev = bars[i - 1]!;
  const prevClose = isFiniteNumber(prev.close) ? prev.close : Number.NaN;
  if (!isFiniteNumber(prevClose)) return highLow;
  const highPrevClose = Math.abs(bar.high - prevClose);
  const lowPrevClose = Math.abs(bar.low - prevClose);
  return Math.max(highLow, highPrevClose, lowPrevClose);
}

/** Build an `IndicatorSeries` from a per-bar value array and the source bars. */
export function toSeries(
  data: readonly OHLCV[],
  values: (number | null)[],
): IndicatorSeries {
  return {
    timestamps: data.map((bar) => bar.date.getTime()),
    values: values.slice(0, data.length),
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const RAW_INDICATORS = [sma, ema, rsi, macd, bollinger, vwap, atr, stochastic, adx];

/** Ordered, id-keyed registry of every built-in indicator. */
export const INDICATOR_REGISTRY: Readonly<Record<string, IndicatorDefinition>> = Object.freeze(
  Object.fromEntries(RAW_INDICATORS.map((definition) => [definition.id, definition])),
);

/** All built-in indicators, in display order. */
export const INDICATORS: readonly IndicatorDefinition[] = RAW_INDICATORS;

/** Look up an indicator definition by its id. */
export function getIndicator(id: string): IndicatorDefinition | undefined {
  return INDICATOR_REGISTRY[id.toLowerCase()];
}

// ---------------------------------------------------------------------------
// Expression helper
// ---------------------------------------------------------------------------

/**
 * Build a chart series expression for an indicator overlay, e.g.
 * `IND:SMA:14:AAPL:price`. The `sourceExpression` is any expression
 * `parseSeriesExpression` already understands (a security, FRED, OWID, …),
 * so the indicator can attach to any chartable base series.
 *
 * Parameters are serialized in a stable, insertion-ordered, `param:value`
 * form so the expression round-trips through `parseIndicatorExpression`.
 */
export function buildIndicatorSeriesExpression(
  indicatorId: string,
  params: IndicatorParams = {},
  sourceExpression = "",
): string {
  const id = indicatorId.toLowerCase();
  const paramTokens = Object.keys(params)
    .sort()
    .map((key) => `${key}:${params[key]}`)
    .filter(Boolean);
  const head = paramTokens.length > 0
    ? `IND:${id}:${paramTokens.join(":")}`
    : `IND:${id}`;
  return sourceExpression.trim() ? `${head}:${sourceExpression.trim()}` : head;
}

export * from "./sma";
export * from "./ema";
export * from "./rsi";
export * from "./macd";
export * from "./bollinger";
export * from "./vwap";
export * from "./atr";
export * from "./stochastic";
export * from "./adx";
