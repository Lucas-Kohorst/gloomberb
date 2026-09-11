/**
 * Shared technical indicators computed from PricePoint[] (OHLCV) data.
 *
 * All functions are pure and isomorphic — no React, DOM, or renderer imports.
 * Used by the pattern-recognition, trend-analysis, technical-summary, and
 * momentum/Sortino plugins.
 */

import type { PricePoint } from "../../../types/financials";

/* ---------- Basic helpers ---------- */

/** Safely extract a number from an array, returning null for NaN or out-of-bounds. */
function safeNum(arr: readonly number[], idx: number): number | null {
  const v = arr[idx]!;
  if (v == null || Number.isNaN(v)) return null;
  return v;
}

export function closes(points: PricePoint[]): number[] {
  return points.map((p) => p.close);
}

export function volumes(points: PricePoint[]): number[] {
  return points.map((p) => p.volume ?? 0);
}

export function highs(points: PricePoint[]): number[] {
  return points.map((p) => p.high ?? p.close);
}

export function lows(points: PricePoint[]): number[] {
  return points.map((p) => p.low ?? p.close);
}

/* ---------- Moving averages ---------- */

export function sma(values: number[], period: number): number[] {
  if (period <= 0) return [];
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  if (period <= 0) return [];
  const out: number[] = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      // seed with SMA
      let s = 0;
      for (let j = 0; j < period; j++) s += values[j]!;
      prev = s / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i]! * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/* ---------- RSI ---------- */

export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period]= avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/* ---------- MACD ---------- */

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    isNaN(emaFast[i]!) || isNaN(emaSlow[i]!) ? NaN : emaFast[i]! - emaSlow[i]!,
  );
  // signal = EMA of macdLine (only over non-NaN portion)
  const firstValid = macdLine.findIndex((v) => !isNaN(v));
  const validMacd = firstValid >= 0 ? macdLine.slice(firstValid) : [];
  const signalValid = ema(validMacd, signalPeriod);
  const signal: number[] = new Array(values.length).fill(NaN);
  const histogram: number[] = new Array(values.length).fill(NaN);
  for (let i = 0; i < signalValid.length; i++) {
    const idx = firstValid + i;
    signal[idx]= signalValid[i]!;
    histogram[idx]= macdLine[idx]! - signalValid[i]!;
  }
  return { macd: macdLine, signal, histogram };
}

/* ---------- Bollinger Bands ---------- */

export interface BollingerResult {
  middle: number[];
  upper: number[];
  lower: number[];
}

export function bollingerBands(values: number[], period = 20, stdDev = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: number[] = new Array(values.length).fill(NaN);
  const lower: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    if (isNaN(middle[i]!)) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (values[j]! - middle[i]!) ** 2;
    }
    const sd = Math.sqrt(variance / period);
    upper[i]= middle[i]! + stdDev * sd;
    lower[i]= middle[i]! - stdDev * sd;
  }
  return { middle, upper, lower };
}

/* ---------- Stochastic Oscillator ---------- */

export interface StochasticResult {
  k: number[];
  d: number[];
}

export function stochastic(
  points: PricePoint[],
  kPeriod = 14,
  dPeriod = 3,
): StochasticResult {
  const hh = highs(points);
  const ll = lows(points);
  const c = closes(points);
  const k: number[] = new Array(points.length).fill(NaN);
  for (let i = kPeriod - 1; i < points.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (hh[j]! > highest) highest = hh[j]!;
      if (ll[j]! < lowest) lowest = ll[j]!;
    }
    const range = highest - lowest;
    k[i]= range === 0 ? 50 : ((c[i]! - lowest) / range) * 100;
  }
  const d = sma(
    k.map((v) => (isNaN(v) ? 0 : v)),
    dPeriod,
  );
  // mask d where k is NaN
  for (let i = 0; i < d.length; i++) {
    if (isNaN(k[i]!)) d[i]= NaN;
  }
  return { k, d };
}

/* ---------- ADX (Average Directional Index) ---------- */

export interface AdxResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function adx(points: PricePoint[], period = 14): AdxResult {
  const n = points.length;
  const plusDI: number[] = new Array(n).fill(NaN);
  const minusDI: number[] = new Array(n).fill(NaN);
  const adxLine: number[] = new Array(n).fill(NaN);

  if (n < period * 2) return { adx: adxLine, plusDI, minusDI };

  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const high = points[i]!.high ?? points[i]!.close;
    const low = points[i]!.low ?? points[i]!.close;
    const prevHigh = points[i - 1]!.high ?? points[i - 1]!.close;
    const prevLow = points[i - 1]!.low ?? points[i - 1]!.close;
    const prevClose = points[i - 1]!.close;

    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDM[i]= upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i]= downMove > upMove && downMove > 0 ? downMove : 0;

    tr[i]= Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
  }

  // Wilder's smoothing
  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smoothPlusDM = plusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);

  for (let i = period; i < n; i++) {
    if (i > period) {
      atr = atr - atr / period + tr[i]!;
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i]!;
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i]!;
    }
    if (atr > 0) {
      plusDI[i]= (smoothPlusDM / atr) * 100;
      minusDI[i]= (smoothMinusDM / atr) * 100;
    }
  }

  // DX and ADX
  const dx: number[] = new Array(n).fill(NaN);
  for (let i = period; i < n; i++) {
    if (isNaN(plusDI[i]!) || isNaN(minusDI[i]!)) continue;
    const sum = plusDI[i]! + minusDI[i]!;
    dx[i]= sum === 0 ? 0 : (Math.abs(plusDI[i]! - minusDI[i]!) / sum) * 100;
  }

  // Wilder's smoothing for ADX
  const firstValidDX = dx.findIndex((v) => !isNaN(v));
  if (firstValidDX >= 0 && firstValidDX + period < n) {
    let adxSum = 0;
    for (let i = firstValidDX; i < firstValidDX + period && i < n; i++) {
      adxSum += dx[i]!;
    }
    let adxVal = adxSum / period;
    adxLine[firstValidDX + period - 1]= adxVal;
    for (let i = firstValidDX + period; i < n; i++) {
      adxVal = (adxVal * (period - 1) + dx[i]!) / period;
      adxLine[i]= adxVal;
    }
  }

  return { adx: adxLine, plusDI, minusDI };
}

/* ---------- Aroon Indicator ---------- */

export interface AroonResult {
  aroonUp: number[];
  aroonDown: number[];
  oscillator: number[];
}

export function aroon(points: PricePoint[], period = 25): AroonResult {
  const n = points.length;
  const aroonUp: number[] = new Array(n).fill(NaN);
  const aroonDown: number[] = new Array(n).fill(NaN);
  const oscillator: number[] = new Array(n).fill(NaN);
  const hh = highs(points);
  const ll = lows(points);

  for (let i = period; i < n; i++) {
    let highIdx = i;
    let lowIdx = i;
    for (let j = i - period; j <= i; j++) {
      if (hh[j]! > hh[highIdx]!) highIdx = j;
      if (ll[j]! < ll[lowIdx]!) lowIdx = j;
    }
    aroonUp[i]= ((period - (i - highIdx)) / period) * 100;
    aroonDown[i]= ((period - (i - lowIdx)) / period) * 100;
    oscillator[i]= aroonUp[i]! - aroonDown[i]!;
  }
  return { aroonUp, aroonDown, oscillator };
}

/* ---------- Momentum & Rate of Change ---------- */

export function momentum(values: number[], period = 10): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i]! - values[i - period]!;
  }
  return out;
}

export function rateOfChange(values: number[], period = 10): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    if (values[i - period]== 0) {
      out[i] = ((values[i]! - values[i - period]!) / values[i - period]!) * 100;
    }
  }
  return out;
}

/* ---------- Returns & Risk Metrics ---------- */

export function periodReturns(values: number[], period = 1): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    if (values[i - period]== 0) {
      out[i] = (values[i]! - values[i - period]!) / values[i - period]!;
    }
  }
  return out;
}

export function annualizedVolatility(values: number[], periodsPerYear = 252): number {
  const returns = periodReturns(values, 1).filter((v) => !isNaN(v));
  if (returns.length < 2) return NaN;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

export function sortinoRatio(
  values: number[],
  riskFreeRate = 0,
  periodsPerYear = 252,
): number {
  const returns = periodReturns(values, 1).filter((v) => !isNaN(v));
  if (returns.length < 2) return NaN;
  const dailyRF = riskFreeRate / periodsPerYear;
  const excess = returns.map((r) => r - dailyRF);
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return Infinity;
  const downsideDev =
    Math.sqrt(
      downside.reduce((a, b) => a + b * b, 0) / downside.length,
    ) * Math.sqrt(periodsPerYear);
  if (downsideDev === 0) return Infinity;
  const annualizedReturn =
    excess.reduce((a, b) => a + b, 0) / excess.length * periodsPerYear;
  return (annualizedReturn) / downsideDev;
}

export function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/* ---------- Chart Pattern Detection ---------- */

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
  confidence: number; // 0..1
  startIdx: number;
  endIdx: number;
  description: string;
}

/**
 * Detect common chart patterns from OHLCV price data.
 * Uses local extrema and trendline analysis. Not a full
 * pattern recognition engine — identifies the most common
 * formations with reasonable confidence.
 */
export function detectPatterns(points: PricePoint[], lookback = 60): PatternMatch[] {
  if (points.length < 20) return [];
  const data = points.slice(-lookback);
  const c = closes(data);
  const hh = highs(data);
  const ll = lows(data);
  const matches: PatternMatch[] = [];
  const offset = points.length - data.length;

  // Find local extrema (pivots)
  const pivotHigh: number[] = [];
  const pivotLow: number[] = [];
  const window = 3;
  for (let i = window; i < data.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (hh[j]! >= hh[i]!) isHigh = false;
      if (ll[j]! <= ll[i]!) isLow = false;
    }
    if (isHigh) pivotHigh.push(i);
    if (isLow) pivotLow.push(i);
  }

  // Double top / double bottom
  if (pivotHigh.length >= 2) {
    const last = pivotHigh[pivotHigh.length - 1]!;
    const prev = pivotHigh[pivotHigh.length - 2]!;
    const diff = Math.abs(hh[last]! - hh[prev]!) / Math.max(hh[prev]!, 1);
    if (diff < 0.03 && last - prev > 5 && last - prev < 40) {
      const trough = Math.min(...ll.slice(prev, last + 1));
      const depth = (Math.max(hh[prev]!, hh[last]!) - trough) / Math.max(hh[prev]!, 1);
      if (depth > 0.02) {
        matches.push({
          type: "double-top",
          confidence: Math.min(0.9, 0.5 + depth),
          startIdx: offset + prev,
          endIdx: offset + last,
          description: `Double top near ${hh[prev]!.toFixed(2)} / ${hh[last]!.toFixed(2)}`,
        });
      }
    }
  }
  if (pivotLow.length >= 2) {
    const last = pivotLow[pivotLow.length - 1]!;
    const prev = pivotLow[pivotLow.length - 2]!;
    const diff = Math.abs(ll[last]! - ll[prev]!) / Math.max(Math.abs(ll[prev]!), 1);
    if (diff < 0.03 && last - prev > 5 && last - prev < 40) {
      const peak = Math.max(...hh.slice(prev, last + 1));
      const rise = (peak - Math.min(ll[prev]!, ll[last]!)) / Math.max(Math.abs(ll[prev]!), 1);
      if (rise > 0.02) {
        matches.push({
          type: "double-bottom",
          confidence: Math.min(0.9, 0.5 + rise),
          startIdx: offset + prev,
          endIdx: offset + last,
          description: `Double bottom near ${ll[prev]!.toFixed(2)} / ${ll[last]!.toFixed(2)}`,
        });
      }
    }
  }

  // Head and shoulders / inverse head and shoulders
  if (pivotHigh.length >= 3) {
    const [a, b, cIdx] = pivotHigh.slice(-3) as [number, number, number];
    if (hh[b]! > hh[a]! && hh[b]! > hh[cIdx]!) {
      const shoulderDiff = Math.abs(hh[a]! - hh[cIdx]!) / Math.max(hh[b]!, 1);
      if (shoulderDiff < 0.08) {
        matches.push({
          type: "head-and-shoulders",
          confidence: Math.min(0.85, 0.6 + (1 - shoulderDiff) * 0.25),
          startIdx: offset + a,
          endIdx: offset + cIdx,
          description: `Head and shoulders: head ${hh[b]!.toFixed(2)}, shoulders ${hh[a]!.toFixed(2)} / ${hh[cIdx]!.toFixed(2)}`,
        });
      }
    }
  }
  if (pivotLow.length >= 3) {
    const [a, b, cIdx] = pivotLow.slice(-3) as [number, number, number];
    if (ll[b]! < ll[a]! && ll[b]! < ll[cIdx]!) {
      const shoulderDiff = Math.abs(ll[a]! - ll[cIdx]!) / Math.max(Math.abs(ll[b]!), 1);
      if (shoulderDiff < 0.08) {
        matches.push({
          type: "inv-head-and-shoulders",
          confidence: Math.min(0.85, 0.6 + (1 - shoulderDiff) * 0.25),
          startIdx: offset + a,
          endIdx: offset + cIdx,
          description: `Inverse head and shoulders: head ${ll[b]!.toFixed(2)}, shoulders ${ll[a]!.toFixed(2)} / ${ll[cIdx]!.toFixed(2)}`,
        });
      }
    }
  }

  // Triangle and wedge detection via linear regression on extrema
  if (pivotHigh.length >= 2 && pivotLow.length >= 2) {
    const recentHighs = pivotHigh.slice(-3);
    const recentLows = pivotLow.slice(-3);
    const highSlope = linearSlope(recentHighs.map((i) => hh[i]!));
    const lowSlope = linearSlope(recentLows.map((i) => ll[i]!));

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
      matches.push({
        type: "symmetrical-triangle",
        confidence: 0.6,
        startIdx: offset + Math.min(recentHighs[0]!, recentLows[0]!),
        endIdx: offset + Math.max(recentHighs[recentHighs.length - 1]!, recentLows[recentLows.length - 1]!),
        description: "Symmetrical triangle: converging trendlines",
      });
    } else if (highSlope > 0.001 && lowSlope > 0.001 && highSlope < lowSlope) {
      matches.push({
        type: "rising-wedge",
        confidence: 0.6,
        startIdx: offset + Math.min(recentHighs[0]!, recentLows[0]!),
        endIdx: offset + Math.max(recentHighs[recentHighs.length - 1]!, recentLows[recentLows.length - 1]!),
        description: "Rising wedge: both lines rising, converging",
      });
    } else if (highSlope < -0.001 && lowSlope < -0.001 && highSlope > lowSlope) {
      matches.push({
        type: "falling-wedge",
        confidence: 0.6,
        startIdx: offset + Math.min(recentHighs[0]!, recentLows[0]!),
        endIdx: offset + Math.max(recentHighs[recentHighs.length - 1]!, recentLows[recentLows.length - 1]!),
        description: "Falling wedge: both lines falling, converging",
      });
    }
  }

  // Channel detection
  if (pivotHigh.length >= 2 && pivotLow.length >= 2) {
    const highSlope = linearSlope(pivotHigh.slice(-3).map((i) => hh[i]!));
    const lowSlope = linearSlope(pivotLow.slice(-3).map((i) => ll[i]!));
    if (highSlope > 0.001 && lowSlope > 0.001) {
      const slopeDiff = Math.abs(highSlope - lowSlope) / Math.max(Math.abs(highSlope), 0.001);
      if (slopeDiff < 0.3) {
        matches.push({
          type: "channel-up",
          confidence: 0.55,
          startIdx: offset + Math.min(pivotHigh[pivotHigh.length - 3]!, pivotLow[pivotLow.length - 3]!),
          endIdx: offset + data.length - 1,
          description: "Ascending channel",
        });
      }
    } else if (highSlope < -0.001 && lowSlope < -0.001) {
      const slopeDiff = Math.abs(highSlope - lowSlope) / Math.max(Math.abs(highSlope), 0.001);
      if (slopeDiff < 0.3) {
        matches.push({
          type: "channel-down",
          confidence: 0.55,
          startIdx: offset + Math.min(pivotHigh[pivotHigh.length - 3]!, pivotLow[pivotLow.length - 3]!),
          endIdx: offset + data.length - 1,
          description: "Descending channel",
        });
      }
    } else if (Math.abs(highSlope) < 0.001 && Math.abs(lowSlope) < 0.001) {
      matches.push({
        type: "range",
        confidence: 0.5,
        startIdx: offset + Math.min(pivotHigh[0]!, pivotLow[0]!),
        endIdx: offset + data.length - 1,
        description: "Trading range / consolidation",
      });
    }
  }

  // Flag detection (sharp move followed by consolidation)
  if (data.length >= 30) {
    const recent = data.slice(-30);
    const firstHalf = recent.slice(0, 15);
    const secondHalf = recent.slice(15);
    const firstMove = (closes(secondHalf)[0]! - closes(firstHalf)[0]!) / closes(firstHalf)[0]!;
    const sc = closes(secondHalf);
    const sMean = sc.reduce((a, b) => a + b, 0) / sc.length;
    const sVar = sc.reduce((a, b) => a + (b - sMean) ** 2, 0) / sc.length;
    const secondVol = sMean !== 0 ? Math.sqrt(sVar) / sMean : 0;
    if (firstMove > 0.08 && secondVol < 0.03) {
      matches.push({
        type: "bull-flag",
        confidence: 0.6,
        startIdx: offset + points.length - 30,
        endIdx: offset + points.length - 1,
        description: `Bull flag: ${ (firstMove * 100).toFixed(1)}% rally followed by tight consolidation`,
      });
    } else if (firstMove < -0.08 && secondVol < 0.03) {
      matches.push({
        type: "bear-flag",
        confidence: 0.6,
        startIdx: offset + points.length - 30,
        endIdx: offset + points.length - 1,
        description: `Bear flag: ${(firstMove * 100).toFixed(1)}% decline followed by tight consolidation`,
      });
    }
  }

  return matches;
}

function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/* ---------- Trend Strength Summary ---------- */

export interface TrendSummary {
  adx: number | null;
  adxTrend: "strong" | "weak" | "ranging";
  direction: "bullish" | "bearish" | "neutral";
  maAlignment: "bullish" | "bearish" | "mixed";
  aroonUp: number | null;
  aroonDown: number | null;
  momentum: number | null;
  priceVsSma20: "above" | "below" | "at";
  priceVsSma50: "above" | "below" | "at";
  priceVsSma200: "above" | "below" | "at";
  score: number; // -100..100, positive = bullish
  label: string;
}

export function computeTrendSummary(points: PricePoint[]): TrendSummary {
  const c = closes(points);
  const last = c.length - 1;
  const price = c[last]!;

  const sma20 = sma(c, 20);
  const sma50 = sma(c, 50);
  const sma200 = sma(c, 200);

  const adxResult = adx(points, 14);
  const aroonResult = aroon(points, 25);
  const mom = momentum(c, 10);

  const adxVal = safeNum(adxResult.adx, last);
  const adxTrend: TrendSummary["adxTrend"]=
    adxVal == null ? "ranging" : adxVal > 25 ? "strong" : adxVal > 20 ? "weak" : "ranging";

  const plusDIVal = safeNum(adxResult.plusDI, last);
  const minusDIVal = safeNum(adxResult.minusDI, last);
  const direction: TrendSummary["direction"]=
    plusDIVal != null && minusDIVal != null
      ? plusDIVal > minusDIVal ? "bullish" : plusDIVal < minusDIVal ? "bearish" : "neutral"
      : "neutral";

  const sma20Val = safeNum(sma20, last);
  const sma50Val = safeNum(sma50, last);
  const sma200Val = safeNum(sma200, last);
  const maAlignment: TrendSummary["maAlignment"]=
    (sma20Val == null || price > sma20Val) &&
    (sma50Val == null || price > sma50Val) &&
    (sma200Val == null || price > sma200Val)
      ? "bullish"
      : (sma20Val == null || price < sma20Val) &&
        (sma50Val == null || price < sma50Val) &&
        (sma200Val == null || price < sma200Val)
        ? "bearish"
        : "mixed";

  const priceVsSma20 = sma20Val != null ? rel(price, sma20Val) : "at";
  const priceVsSma50 = sma50Val != null ? rel(price, sma50Val) : "at";
  const priceVsSma200 = sma200Val != null ? rel(price, sma200Val) : "at";

  const aroonUp = safeNum(aroonResult.aroonUp, last);
  const aroonDown = safeNum(aroonResult.aroonDown, last);
  const momentumVal = safeNum(mom, last);

  // Score from -100 to +100
  let score = 0;
  if (adxVal != null) {
    score += (direction === "bullish" ? 1 : direction === "bearish" ? -1 : 0) * adxVal * 0.4;
  }
  if (maAlignment === "bullish") score += 20;
  else if (maAlignment === "bearish") score -= 20;
  if (priceVsSma20 === "above") score += 10;
  else if (priceVsSma20 === "below") score -= 10;
  if (priceVsSma50 === "above") score += 10;
  else if (priceVsSma50 === "below") score -= 10;
  if (priceVsSma200 === "above") score += 15;
  else if (priceVsSma200 === "below") score -= 15;
  if (aroonUp != null && aroonDown != null) {
    score += (aroonUp - aroonDown) * 0.15;
  }
  if (momentumVal != null) {
    score += Math.max(-20, Math.min(20, (momentumVal / price) * 100));
  }
  score = Math.max(-100, Math.min(100, score));

  const label =
    score > 40 ? "Strong Uptrend" :
    score > 15 ? "Uptrend" :
    score > -15 ? "Sideways / Mixed" :
    score > -40 ? "Downtrend" :
    "Strong Downtrend";

  return {
    adx: adxVal,
    adxTrend,
    direction,
    maAlignment,
    aroonUp,
    aroonDown,
    momentum: momentumVal,
    priceVsSma20,
    priceVsSma50,
    priceVsSma200,
    score,
    label,
  };
}

function rel(price: number, ma: number): "above" | "below" | "at" {
  if (isNaN(ma)) return "at";
  const diff = (price - ma) / ma;
  if (Math.abs(diff) < 0.005) return "at";
  return diff > 0 ? "above" : "below";
}

/* ---------- Technical Analysis Summary ---------- */

export interface TechnicalSummary {
  rsi: number | null;
  rsiSignal: "overbought" | "oversold" | "neutral";
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  macdSignalType: "bullish" | "bearish" | "neutral";
  bollingerPosition: "above-upper" | "below-lower" | "within" | "at-upper" | "at-lower";
  bollingerWidth: number | null;
  stochasticK: number | null;
  stochasticD: number | null;
  stochasticSignal: "overbought" | "oversold" | "neutral";
  adx: number | null;
  volumeAvg: number | null;
  volumeRatio: number | null;
  summary: string;
}

export function computeTechnicalSummary(points: PricePoint[]): TechnicalSummary {
  const c = closes(points);
  const v = volumes(points);
  const last = c.length - 1;

  const rsiVal = rsi(c, 14);
  const rsiLast = safeNum(rsiVal, last);
  const rsiSignal: TechnicalSummary["rsiSignal"]=
    rsiLast == null ? "neutral" : rsiLast > 70 ? "overbought" : rsiLast < 30 ? "oversold" : "neutral";

  const macdResult = macd(c);
  const macdLast = safeNum(macdResult.macd, last);
  const macdSignalVal = safeNum(macdResult.signal, last);
  const macdHist = safeNum(macdResult.histogram, last);
  const macdSignalType: TechnicalSummary["macdSignalType"]=
    macdHist == null ? "neutral" : macdHist > 0 ? "bullish" : macdHist < 0 ? "bearish" : "neutral";

  const bb = bollingerBands(c, 20, 2);
  const bbMid = safeNum(bb.middle, last);
  const bbUpper = safeNum(bb.upper, last);
  const bbLower = safeNum(bb.lower, last);
  let bollingerPosition: TechnicalSummary["bollingerPosition"]= "within";
  let bollingerWidth: number | null = null;
  if (bbUpper != null && bbLower != null && bbMid != null && bbMid !== 0) {
    bollingerWidth = (bbUpper - bbLower) / bbMid;
    const diff = (c[last]! - bbMid) / (bbUpper - bbLower) * 2;
    if (diff > 1) bollingerPosition = "above-upper";
    else if (diff < -1) bollingerPosition = "below-lower";
    else if (diff > 0.9) bollingerPosition = "at-upper";
    else if (diff < -0.9) bollingerPosition = "at-lower";
  }

  const stoch = stochastic(points, 14, 3);
  const stochK = safeNum(stoch.k, last);
  const stochD = safeNum(stoch.d, last);
  const stochasticSignal: TechnicalSummary["stochasticSignal"]=
    stochK == null ? "neutral" : stochK > 80 ? "overbought" : stochK < 20 ? "oversold" : "neutral";

  const adxResult = adx(points, 14);
  const adxVal = safeNum(adxResult.adx, last);

  const volSma = sma(v, 20);
  const volumeAvg = safeNum(volSma, last);
  const volumeRatio = volumeAvg != null && volumeAvg > 0 ? v[last]! / volumeAvg : null;

  const signals: string[] = [];
  if (rsiSignal === "overbought") signals.push("RSI overbought");
  if (rsiSignal === "oversold") signals.push("RSI oversold");
  if (macdSignalType === "bullish") signals.push("MACD bullish");
  if (macdSignalType === "bearish") signals.push("MACD bearish");
  if (bollingerPosition === "above-upper") signals.push("above upper Bollinger Band");
  if (bollingerPosition === "below-lower") signals.push("below lower Bollinger Band");
  if (stochasticSignal === "overbought") signals.push("Stochastic overbought");
  if (stochasticSignal === "oversold") signals.push("Stochastic oversold");
  if (adxVal != null && adxVal > 25) signals.push(`ADX ${adxVal.toFixed(0)} (strong trend)`);
  if (volumeRatio != null && volumeRatio > 1.5) signals.push("elevated volume");

  const summary = signals.length > 0
    ? signals.join("; ")
    : "No notable signals — price action within normal ranges.";

  return {
    rsi: rsiLast,
    rsiSignal,
    macd: macdLast,
    macdSignal: macdSignalVal,
    macdHistogram: macdHist,
    macdSignalType,
    bollingerPosition,
    bollingerWidth,
    stochasticK: stochK,
    stochasticD: stochD,
    stochasticSignal,
    adx: adxVal,
    volumeAvg,
    volumeRatio,
    summary,
  };
}
