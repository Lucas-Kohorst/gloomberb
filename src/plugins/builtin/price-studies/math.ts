import type { PricePoint } from "../../../types/financials";

export type PatternType =
  | "double-top"
  | "double-bottom"
  | "head-and-shoulders"
  | "inv-head-and-shoulders"
  | "ascending-triangle"
  | "descending-triangle"
  | "symmetrical-triangle"
  | "rising-wedge"
  | "falling-wedge"
  | "bull-flag"
  | "bear-flag"
  | "channel-up"
  | "channel-down"
  | "range";

export interface PatternMatch {
  type: PatternType;
  /** 0 to 1. */
  confidence: number;
  startIdx: number;
  endIdx: number;
  description: string;
}

export interface TrendSummary {
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
  adxTrend: "strong" | "weak" | "ranging";
  direction: "bullish" | "bearish" | "neutral";
  maAlignment: "bullish" | "bearish" | "mixed";
  aroonUp: number | null;
  aroonDown: number | null;
  priceVsSma20: "above" | "below" | "at";
  priceVsSma50: "above" | "below" | "at";
  priceVsSma200: "above" | "below" | "at";
}

export interface MomentumSnapshot {
  momentum: number | null;
  rateOfChange: number | null;
  volatility: number | null;
  sortino: number | null;
  maxDrawdown: number | null;
  bestDay: number | null;
  worstDay: number | null;
  averageDay: number | null;
}

function closeValues(points: readonly PricePoint[]): number[] {
  return points.map((point) => point.close);
}

function highValues(points: readonly PricePoint[]): number[] {
  return points.map((point) => point.high ?? point.close);
}

function lowValues(points: readonly PricePoint[]): number[] {
  return points.map((point) => point.low ?? point.close);
}

function at(values: readonly number[], index: number): number | null {
  const value = values[index];
  return value == null || Number.isNaN(value) ? null : value;
}

function sma(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (period <= 0) return out;
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index]!;
    if (index >= period) sum -= values[index - period]!;
    if (index >= period - 1) out[index] = sum / period;
  }
  return out;
}

export function momentum(values: readonly number[], period = 10): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  for (let index = period; index < values.length; index += 1) out[index] = values[index]! - values[index - period]!;
  return out;
}

export function rateOfChange(values: readonly number[], period = 10): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  for (let index = period; index < values.length; index += 1) {
    const base = values[index - period]!;
    if (base !== 0) out[index] = ((values[index]! - base) / base) * 100;
  }
  return out;
}

export function periodReturns(values: readonly number[], period = 1): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  for (let index = period; index < values.length; index += 1) {
    const base = values[index - period]!;
    if (base !== 0) out[index] = (values[index]! - base) / base;
  }
  return out;
}

export function annualizedVolatility(values: readonly number[], periodsPerYear = 252): number {
  const returns = periodReturns(values, 1).filter((value) => !Number.isNaN(value));
  if (returns.length < 2) return Number.NaN;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

export function sortinoRatio(values: readonly number[], riskFreeRate = 0, periodsPerYear = 252): number {
  const returns = periodReturns(values, 1).filter((value) => !Number.isNaN(value));
  if (returns.length < 2) return Number.NaN;
  const dailyRiskFree = riskFreeRate / periodsPerYear;
  const excess = returns.map((value) => value - dailyRiskFree);
  const downside = excess.filter((value) => value < 0);
  if (downside.length === 0) return Number.POSITIVE_INFINITY;
  const downsideDeviation = Math.sqrt(downside.reduce((sum, value) => sum + value * value, 0) / downside.length) * Math.sqrt(periodsPerYear);
  if (downsideDeviation === 0) return Number.POSITIVE_INFINITY;
  const annualized = excess.reduce((sum, value) => sum + value, 0) / excess.length * periodsPerYear;
  return annualized / downsideDeviation;
}

/** Peak-to-trough decline as a positive fraction of the peak. */
export function maxDrawdown(values: readonly number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = (peak - value) / peak;
      if (drawdown > worst) worst = drawdown;
    }
  }
  return worst;
}

interface AdxSeries {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function adx(points: readonly PricePoint[], period = 14): AdxSeries {
  const count = points.length;
  const plusDI = new Array<number>(count).fill(Number.NaN);
  const minusDI = new Array<number>(count).fill(Number.NaN);
  const adxLine = new Array<number>(count).fill(Number.NaN);
  if (count < period * 2) return { adx: adxLine, plusDI, minusDI };

  const plusDM = new Array<number>(count).fill(0);
  const minusDM = new Array<number>(count).fill(0);
  const trueRange = new Array<number>(count).fill(0);
  for (let index = 1; index < count; index += 1) {
    const high = points[index]!.high ?? points[index]!.close;
    const low = points[index]!.low ?? points[index]!.close;
    const previousHigh = points[index - 1]!.high ?? points[index - 1]!.close;
    const previousLow = points[index - 1]!.low ?? points[index - 1]!.close;
    const previousClose = points[index - 1]!.close;
    const upMove = high - previousHigh;
    const downMove = previousLow - low;
    plusDM[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    trueRange[index] = Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  }

  let atr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  for (let index = 1; index <= period; index += 1) {
    atr += trueRange[index]!;
    smoothPlus += plusDM[index]!;
    smoothMinus += minusDM[index]!;
  }
  const dx = new Array<number>(count).fill(Number.NaN);
  for (let index = period; index < count; index += 1) {
    if (index > period) {
      atr = atr - atr / period + trueRange[index]!;
      smoothPlus = smoothPlus - smoothPlus / period + plusDM[index]!;
      smoothMinus = smoothMinus - smoothMinus / period + minusDM[index]!;
    }
    if (atr <= 0) continue;
    plusDI[index] = (smoothPlus / atr) * 100;
    minusDI[index] = (smoothMinus / atr) * 100;
    const sum = plusDI[index]! + minusDI[index]!;
    dx[index] = sum === 0 ? 0 : (Math.abs(plusDI[index]! - minusDI[index]!) / sum) * 100;
  }

  const first = dx.findIndex((value) => !Number.isNaN(value));
  if (first >= 0 && first + period < count) {
    let smoothed = 0;
    for (let index = first; index < first + period; index += 1) smoothed += dx[index]!;
    smoothed /= period;
    adxLine[first + period - 1] = smoothed;
    for (let index = first + period; index < count; index += 1) {
      smoothed = (smoothed * (period - 1) + dx[index]!) / period;
      adxLine[index] = smoothed;
    }
  }
  return { adx: adxLine, plusDI, minusDI };
}

export function aroon(points: readonly PricePoint[], period = 25): { aroonUp: number[]; aroonDown: number[] } {
  const count = points.length;
  const aroonUp = new Array<number>(count).fill(Number.NaN);
  const aroonDown = new Array<number>(count).fill(Number.NaN);
  const highs = highValues(points);
  const lows = lowValues(points);
  for (let index = period; index < count; index += 1) {
    let highIndex = index;
    let lowIndex = index;
    for (let cursor = index - period; cursor <= index; cursor += 1) {
      if (highs[cursor]! > highs[highIndex]!) highIndex = cursor;
      if (lows[cursor]! < lows[lowIndex]!) lowIndex = cursor;
    }
    aroonUp[index] = ((period - (index - highIndex)) / period) * 100;
    aroonDown[index] = ((period - (index - lowIndex)) / period) * 100;
  }
  return { aroonUp, aroonDown };
}

function linearSlope(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const count = values.length;
  const xMean = (count - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < count; index += 1) {
    numerator += (index - xMean) * (values[index]! - yMean);
    denominator += (index - xMean) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function earliest(indices: readonly number[]): number {
  return indices[Math.max(0, indices.length - 3)]!;
}

export function detectPatterns(points: readonly PricePoint[], lookback = 60): PatternMatch[] {
  if (points.length < 20) return [];
  const data = points.slice(-lookback);
  const highs = highValues(data);
  const lows = lowValues(data);
  const matches: PatternMatch[] = [];
  const offset = points.length - data.length;
  const pivotHigh: number[] = [];
  const pivotLow: number[] = [];
  const window = 3;
  for (let index = window; index < data.length - window; index += 1) {
    let isHigh = true;
    let isLow = true;
    for (let cursor = index - window; cursor <= index + window; cursor += 1) {
      if (cursor === index) continue;
      if (highs[cursor]! >= highs[index]!) isHigh = false;
      if (lows[cursor]! <= lows[index]!) isLow = false;
    }
    if (isHigh) pivotHigh.push(index);
    if (isLow) pivotLow.push(index);
  }

  if (pivotHigh.length >= 2) {
    const last = pivotHigh[pivotHigh.length - 1]!;
    const previous = pivotHigh[pivotHigh.length - 2]!;
    const difference = Math.abs(highs[last]! - highs[previous]!) / Math.max(highs[previous]!, 1);
    if (difference < 0.03 && last - previous > 5 && last - previous < 40) {
      const trough = Math.min(...lows.slice(previous, last + 1));
      const depth = (Math.max(highs[previous]!, highs[last]!) - trough) / Math.max(highs[previous]!, 1);
      if (depth > 0.02) {
        matches.push({
          type: "double-top",
          confidence: Math.min(0.9, 0.5 + depth),
          startIdx: offset + previous,
          endIdx: offset + last,
          description: `Double top near ${highs[previous]!.toFixed(2)} / ${highs[last]!.toFixed(2)}`,
        });
      }
    }
  }
  if (pivotLow.length >= 2) {
    const last = pivotLow[pivotLow.length - 1]!;
    const previous = pivotLow[pivotLow.length - 2]!;
    const difference = Math.abs(lows[last]! - lows[previous]!) / Math.max(Math.abs(lows[previous]!), 1);
    if (difference < 0.03 && last - previous > 5 && last - previous < 40) {
      const peak = Math.max(...highs.slice(previous, last + 1));
      const rise = (peak - Math.min(lows[previous]!, lows[last]!)) / Math.max(Math.abs(lows[previous]!), 1);
      if (rise > 0.02) {
        matches.push({
          type: "double-bottom",
          confidence: Math.min(0.9, 0.5 + rise),
          startIdx: offset + previous,
          endIdx: offset + last,
          description: `Double bottom near ${lows[previous]!.toFixed(2)} / ${lows[last]!.toFixed(2)}`,
        });
      }
    }
  }

  if (pivotHigh.length >= 3) {
    const [left, head, right] = pivotHigh.slice(-3) as [number, number, number];
    if (highs[head]! > highs[left]! && highs[head]! > highs[right]!) {
      const shoulderDifference = Math.abs(highs[left]! - highs[right]!) / Math.max(highs[head]!, 1);
      if (shoulderDifference < 0.08) {
        matches.push({
          type: "head-and-shoulders",
          confidence: Math.min(0.85, 0.6 + (1 - shoulderDifference) * 0.25),
          startIdx: offset + left,
          endIdx: offset + right,
          description: `Head and shoulders: head ${highs[head]!.toFixed(2)}, shoulders ${highs[left]!.toFixed(2)} / ${highs[right]!.toFixed(2)}`,
        });
      }
    }
  }
  if (pivotLow.length >= 3) {
    const [left, head, right] = pivotLow.slice(-3) as [number, number, number];
    if (lows[head]! < lows[left]! && lows[head]! < lows[right]!) {
      const shoulderDifference = Math.abs(lows[left]! - lows[right]!) / Math.max(Math.abs(lows[head]!), 1);
      if (shoulderDifference < 0.08) {
        matches.push({
          type: "inv-head-and-shoulders",
          confidence: Math.min(0.85, 0.6 + (1 - shoulderDifference) * 0.25),
          startIdx: offset + left,
          endIdx: offset + right,
          description: `Inverse head and shoulders: head ${lows[head]!.toFixed(2)}, shoulders ${lows[left]!.toFixed(2)} / ${lows[right]!.toFixed(2)}`,
        });
      }
    }
  }

  if (pivotHigh.length >= 2 && pivotLow.length >= 2) {
    const recentHighs = pivotHigh.slice(-3);
    const recentLows = pivotLow.slice(-3);
    const highSlope = linearSlope(recentHighs.map((index) => highs[index]!));
    const lowSlope = linearSlope(recentLows.map((index) => lows[index]!));
    const start = offset + Math.min(recentHighs[0]!, recentLows[0]!);
    const end = offset + Math.max(recentHighs[recentHighs.length - 1]!, recentLows[recentLows.length - 1]!);
    if (highSlope > 0.001 && Math.abs(lowSlope) < 0.001) {
      matches.push({
        type: "ascending-triangle",
        confidence: 0.65,
        startIdx: offset + recentLows[0]!,
        endIdx: offset + recentHighs[recentHighs.length - 1]!,
        description: "Ascending triangle: flat resistance, rising support",
      });
    } else if (highSlope < -0.001 && Math.abs(lowSlope) < 0.001) {
      matches.push({
        type: "descending-triangle",
        confidence: 0.65,
        startIdx: offset + recentHighs[0]!,
        endIdx: offset + recentLows[recentLows.length - 1]!,
        description: "Descending triangle: flat support, falling resistance",
      });
    } else if (highSlope < -0.001 && lowSlope > 0.001) {
      matches.push({ type: "symmetrical-triangle", confidence: 0.6, startIdx: start, endIdx: end, description: "Symmetrical triangle: converging trendlines" });
    } else if (highSlope > 0.001 && lowSlope > 0.001 && highSlope < lowSlope) {
      matches.push({ type: "rising-wedge", confidence: 0.6, startIdx: start, endIdx: end, description: "Rising wedge: both lines rising, converging" });
    } else if (highSlope < -0.001 && lowSlope < -0.001 && highSlope > lowSlope) {
      matches.push({ type: "falling-wedge", confidence: 0.6, startIdx: start, endIdx: end, description: "Falling wedge: both lines falling, converging" });
    }
  }

  if (pivotHigh.length >= 2 && pivotLow.length >= 2) {
    const highSlope = linearSlope(pivotHigh.slice(-3).map((index) => highs[index]!));
    const lowSlope = linearSlope(pivotLow.slice(-3).map((index) => lows[index]!));
    const startIdx = offset + Math.min(earliest(pivotHigh), earliest(pivotLow));
    const endIdx = offset + data.length - 1;
    if (highSlope > 0.001 && lowSlope > 0.001) {
      const slopeDifference = Math.abs(highSlope - lowSlope) / Math.max(Math.abs(highSlope), 0.001);
      if (slopeDifference < 0.3) matches.push({ type: "channel-up", confidence: 0.55, startIdx, endIdx, description: "Ascending channel" });
    } else if (highSlope < -0.001 && lowSlope < -0.001) {
      const slopeDifference = Math.abs(highSlope - lowSlope) / Math.max(Math.abs(highSlope), 0.001);
      if (slopeDifference < 0.3) matches.push({ type: "channel-down", confidence: 0.55, startIdx, endIdx, description: "Descending channel" });
    } else if (Math.abs(highSlope) < 0.001 && Math.abs(lowSlope) < 0.001) {
      matches.push({
        type: "range",
        confidence: 0.5,
        startIdx: offset + Math.min(pivotHigh[0]!, pivotLow[0]!),
        endIdx,
        description: "Trading range / consolidation",
      });
    }
  }

  if (data.length >= 30) {
    const recent = data.slice(-30);
    const firstHalf = recent.slice(0, 15);
    const secondHalf = recent.slice(15);
    const firstClose = firstHalf[0]!.close;
    const firstMove = firstClose === 0 ? 0 : (secondHalf[0]!.close - firstClose) / firstClose;
    const secondCloses = closeValues(secondHalf);
    const mean = secondCloses.reduce((sum, value) => sum + value, 0) / secondCloses.length;
    const variance = secondCloses.reduce((sum, value) => sum + (value - mean) ** 2, 0) / secondCloses.length;
    const secondVolatility = mean !== 0 ? Math.sqrt(variance) / mean : 0;
    if (firstMove > 0.08 && secondVolatility < 0.03) {
      matches.push({
        type: "bull-flag",
        confidence: 0.6,
        startIdx: offset + data.length - 30,
        endIdx: offset + data.length - 1,
        description: `Bull flag: ${(firstMove * 100).toFixed(1)}% rally followed by tight consolidation`,
      });
    } else if (firstMove < -0.08 && secondVolatility < 0.03) {
      matches.push({
        type: "bear-flag",
        confidence: 0.6,
        startIdx: offset + data.length - 30,
        endIdx: offset + data.length - 1,
        description: `Bear flag: ${(firstMove * 100).toFixed(1)}% decline followed by tight consolidation`,
      });
    }
  }

  return matches;
}

function versus(price: number, average: number | null): TrendSummary["priceVsSma20"] {
  if (average == null || Number.isNaN(average) || average === 0) return "at";
  const difference = (price - average) / average;
  if (Math.abs(difference) < 0.005) return "at";
  return difference > 0 ? "above" : "below";
}

export function computeTrendSummary(points: readonly PricePoint[]): TrendSummary {
  const closes = closeValues(points);
  const last = closes.length - 1;
  const price = closes[last] ?? Number.NaN;
  const sma20 = at(sma(closes, 20), last);
  const sma50 = at(sma(closes, 50), last);
  const sma200 = at(sma(closes, 200), last);
  const directional = adx(points, 14);
  const aroonResult = aroon(points, 25);
  const adxValue = at(directional.adx, last);
  const plusDI = at(directional.plusDI, last);
  const minusDI = at(directional.minusDI, last);
  const aboveAll = (sma20 == null || price > sma20) && (sma50 == null || price > sma50) && (sma200 == null || price > sma200);
  const belowAll = (sma20 == null || price < sma20) && (sma50 == null || price < sma50) && (sma200 == null || price < sma200);
  return {
    adx: adxValue,
    plusDI,
    minusDI,
    adxTrend: adxValue == null ? "ranging" : adxValue > 25 ? "strong" : adxValue > 20 ? "weak" : "ranging",
    direction: plusDI == null || minusDI == null ? "neutral" : plusDI > minusDI ? "bullish" : plusDI < minusDI ? "bearish" : "neutral",
    maAlignment: aboveAll ? "bullish" : belowAll ? "bearish" : "mixed",
    aroonUp: at(aroonResult.aroonUp, last),
    aroonDown: at(aroonResult.aroonDown, last),
    priceVsSma20: versus(price, sma20),
    priceVsSma50: versus(price, sma50),
    priceVsSma200: versus(price, sma200),
  };
}

export function momentumSnapshot(points: readonly PricePoint[], periodsPerYear = 252): MomentumSnapshot {
  const closes = closeValues(points);
  const last = closes.length - 1;
  const daily = periodReturns(closes, 1).filter((value) => Number.isFinite(value));
  const volatility = annualizedVolatility(closes, periodsPerYear);
  const sortino = sortinoRatio(closes, 0, periodsPerYear);
  return {
    momentum: at(momentum(closes, 10), last),
    rateOfChange: at(rateOfChange(closes, 10), last),
    volatility: Number.isNaN(volatility) ? null : volatility,
    sortino: Number.isNaN(sortino) ? null : sortino,
    maxDrawdown: closes.length ? maxDrawdown(closes) : null,
    bestDay: daily.length ? Math.max(...daily) : null,
    worstDay: daily.length ? Math.min(...daily) : null,
    averageDay: daily.length ? daily.reduce((sum, value) => sum + value, 0) / daily.length : null,
  };
}
