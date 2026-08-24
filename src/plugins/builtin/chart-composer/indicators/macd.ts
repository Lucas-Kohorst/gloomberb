import {
  closePrice,
  emaArray,
  isFiniteNumber,
  positiveInt,
  toSeries,
  type IndicatorDefinition,
  type IndicatorOutput,
  type IndicatorParams,
  type OHLCV,
} from "./index";

/**
 * MACD — `fast` EMA minus `slow` EMA (the MACD line), an EMA of the MACD line
 * over `signal` bars (the signal line), and the difference as a histogram.
 * Sub-panel oscillator. The MACD line starts once the slow EMA is seeded; the
 * signal line and histogram start `signal` bars after that.
 */
export function macd(data: OHLCV[], params: IndicatorParams = {}): IndicatorOutput {
  const fast = positiveInt(params.fast, 12);
  const slow = positiveInt(params.slow, 26);
  const signal = positiveInt(params.signal, 9);
  const closes = data.map((bar) => closePrice(bar) ?? Number.NaN);
  const emaFast = emaArray(closes, fast);
  const emaSlow = emaArray(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== null && s !== null ? f - s : null;
  });
  // EMA over the defined MACD values; nulls become gaps that emaArray skips.
  const macdForEma = macdLine.map((value) => (value === null ? Number.NaN : value));
  const signalLine = emaArray(macdForEma, signal);
  const histogram: (number | null)[] = closes.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return m !== null && s !== null && isFiniteNumber(m - s) ? m - s : null;
  });
  return {
    macd: toSeries(data, macdLine),
    signal: toSeries(data, signalLine),
    histogram: toSeries(data, histogram),
  };
}

export const definition: IndicatorDefinition = {
  id: "macd",
  label: "MACD",
  description: "fast/slow EMA difference with a signal EMA and histogram.",
  defaultParams: { fast: 12, slow: 26, signal: 9 },
  outputs: ["macd", "signal", "histogram"],
  pane: "sub",
  apply: macd,
};
