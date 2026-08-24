import {
  closePrice,
  isFiniteNumber,
  positiveInt,
  toSeries,
  wilderSmooth,
  type IndicatorDefinition,
  type IndicatorOutput,
  type IndicatorParams,
  type OHLCV,
} from "./index";

/**
 * Relative Strength Index (Wilder). `RS = avgGain / avgLoss` where the averages
 * use Wilder smoothing seeded from the first `period` close-to-close changes.
 * RSI = 100 - 100/(1+RS), bounded to 0–100. Sub-panel oscillator; `null` until
 * `period` changes are available (first value at index `period`).
 */
export function rsi(data: OHLCV[], params: IndicatorParams = {}): IndicatorOutput {
  const period = positiveInt(params.period, 14);
  const closes = data.map((bar) => closePrice(bar) ?? Number.NaN);
  const gains: number[] = new Array(closes.length).fill(Number.NaN);
  const losses: number[] = new Array(closes.length).fill(Number.NaN);
  for (let i = 1; i < closes.length; i += 1) {
    if (Number.isNaN(closes[i]) || Number.isNaN(closes[i - 1])) continue;
    const change = closes[i]! - closes[i - 1]!;
    gains[i] = change > 0 ? change : 0;
    losses[i] = change < 0 ? -change : 0;
  }
  const avgGain = wilderSmooth(gains, period, 1);
  const avgLoss = wilderSmooth(losses, period, 1);
  const values: (number | null)[] = closes.map((_, i) => {
    const ag = avgGain[i];
    const al = avgLoss[i];
    if (ag === null || al === null) return null;
    if (al === 0) return ag === 0 ? 50 : 100;
    const rs = ag / al;
    return isFiniteNumber(rs) ? 100 - 100 / (1 + rs) : null;
  });
  return { rsi: toSeries(data, values) };
}

export const definition: IndicatorDefinition = {
  id: "rsi",
  label: "Relative Strength Index",
  description: "Wilder RSI — momentum oscillator bounded to 0–100.",
  defaultParams: { period: 14 },
  outputs: ["rsi"],
  pane: "sub",
  apply: rsi,
};
