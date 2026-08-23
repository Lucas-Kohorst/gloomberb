import {
  closePrice,
  isFiniteNumber,
  positiveInt,
  smaArray,
  toSeries,
  type IndicatorDefinition,
  type IndicatorOutput,
  type IndicatorParams,
  type OHLCV,
} from "./index";

/**
 * Stochastic Oscillator — `%K` is the close's position within the trailing
 * `period` high/low range, scaled to 0–100; `%D` is an SMA of `%K` over `smooth`
 * bars. Sub-panel oscillator. `%K` is `null` until `period` bars are available
 * and for any window containing a missing high/low/close; `%D` follows `smooth`
 * bars later.
 */
export function stochastic(data: OHLCV[], params: IndicatorParams = {}): IndicatorOutput {
  const period = positiveInt(params.period, 14);
  const smooth = positiveInt(params.smooth, 3);
  const highs = data.map((bar) => (isFiniteNumber(bar.high) ? bar.high : Number.NaN));
  const lows = data.map((bar) => (isFiniteNumber(bar.low) ? bar.low : Number.NaN));
  const closes = data.map((bar) => closePrice(bar) ?? Number.NaN);
  const k: (number | null)[] = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i += 1) {
    const highWindow = highs.slice(i - period + 1, i + 1);
    const lowWindow = lows.slice(i - period + 1, i + 1);
    const close = closes[i]!;
    if (Number.isNaN(close) || highWindow.some(Number.isNaN) || lowWindow.some(Number.isNaN)) {
      continue;
    }
    const highest = Math.max(...highWindow);
    const lowest = Math.min(...lowWindow);
    const range = highest - lowest;
    k[i] = range === 0 ? 100 : ((close - lowest) / range) * 100;
  }
  // %D is an SMA over %K; smaArray already nulls warmup and NaN windows.
  const kForSma = k.map((value) => (value === null ? Number.NaN : value));
  const d = smaArray(kForSma, smooth);
  return {
    k: toSeries(data, k),
    d: toSeries(data, d),
  };
}

export const definition: IndicatorDefinition = {
  id: "stochastic",
  label: "Stochastic Oscillator",
  description: "%K position in the period high/low range with an SMA %D.",
  defaultParams: { period: 14, smooth: 3 },
  outputs: ["k", "d"],
  pane: "sub",
  apply: stochastic,
};
