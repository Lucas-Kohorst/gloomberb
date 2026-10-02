import type { PricePoint } from "../../../types/financials";

const TRADING_DAYS = 252;

export function realizedVolatilityCadenceIssue(points: readonly Pick<PricePoint, "date">[]): string | null {
  const timestamps = new Set<number>();
  for (const point of points) {
    const time = new Date(point.date).getTime();
    if (!Number.isFinite(time)) return "Realized volatility unavailable: invalid history date";
    timestamps.add(time);
  }
  const history = [...timestamps].sort((a, b) => a - b);
  const days = new Set<number>();
  const gaps: number[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const time = history[index]!;
    const day = Math.floor(time / 86_400_000);
    if (days.has(day)) return "Daily history unavailable: intraday observations returned";
    days.add(day);
    if (index > 0) gaps.push(time - history[index - 1]!);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[middle]! : (gaps[middle - 1]! + gaps[middle]!) / 2;
  return median >= 5 * 86_400_000 ? "Daily history unavailable: observed cadence is weekly or slower" : null;
}

interface Observation { time: number; close: number | null }

function observations(points: readonly PricePoint[]): Observation[] | null {
  const dates = new Map<number, number | null>();
  for (const point of points) {
    const time = new Date(point.date).getTime();
    if (!Number.isFinite(time)) return null;
    const close = typeof point.close === "number" && Number.isFinite(point.close) && point.close > 0 ? Math.log(point.close) : null;
    dates.set(time, close);
  }
  return [...dates.entries()].sort(([a], [b]) => a - b).map(([time, close]) => ({ time, close }));
}

function sampleVariance(values: readonly number[]): number {
  let mean = 0;
  let squaredDeviations = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const delta = value - mean;
    mean += delta / (index + 1);
    squaredDeviations += delta * (value - mean);
  }
  return squaredDeviations / (values.length - 1);
}

function estimate(history: readonly Observation[], end: number, window: number): number | null {
  if (!Number.isInteger(window) || window < 2 || end - window < 0) return null;
  const returns: number[] = [];
  for (let index = end - window + 1; index <= end; index += 1) {
    const close = history[index]!.close;
    const previous = history[index - 1]!.close;
    if (close == null || previous == null) return null;
    returns.push(close - previous);
  }
  const variance = sampleVariance(returns);
  return Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance * TRADING_DAYS) : null;
}

/** Latest close-to-close annualized volatility. Close-only bars are enough. */
export function realizedVolatility(points: readonly PricePoint[], window = 30): number | null {
  const history = observations(points);
  return history ? estimate(history, history.length - 1, window) : null;
}

export interface RollingRealizedVolatilityPoint {
  date: Date;
  values: Readonly<Record<number, number | null>>;
}

export function rollingRealizedVolatility(
  points: readonly PricePoint[],
  options: { windows?: readonly number[] } = {},
): RollingRealizedVolatilityPoint[] {
  const history = observations(points);
  if (!history) return [];
  const windows = [...new Set(options.windows ?? [20])];
  return history.map((point, index) => ({
    date: new Date(point.time),
    values: Object.fromEntries(windows.map((window) => [window, estimate(history, index, window)])),
  }));
}
