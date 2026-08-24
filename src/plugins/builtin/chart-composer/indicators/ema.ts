import {
  closePrice,
  emaArray,
  positiveInt,
  toSeries,
  type IndicatorDefinition,
  type IndicatorOutput,
  type IndicatorParams,
  type OHLCV,
} from "./index";

/**
 * Exponential Moving Average — close weighted with `k = 2 / (period + 1)`,
 * seeded from the SMA of the first `period` closes. Overlays the price pane.
 */
export function ema(data: OHLCV[], params: IndicatorParams = {}): IndicatorOutput {
  const period = positiveInt(params.period, 20);
  const closes = data.map((bar) => closePrice(bar) ?? Number.NaN);
  return { ema: toSeries(data, emaArray(closes, period)) };
}

export const definition: IndicatorDefinition = {
  id: "ema",
  label: "Exponential Moving Average",
  description: "Close weighted with k = 2/(period+1), seeded from the first period SMA.",
  defaultParams: { period: 20 },
  outputs: ["ema"],
  pane: "overlay",
  apply: ema,
};
