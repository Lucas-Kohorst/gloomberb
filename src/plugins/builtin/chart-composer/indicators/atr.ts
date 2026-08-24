import {
  positiveInt,
  toSeries,
  trueRange,
  wilderSmooth,
  type IndicatorDefinition,
  type IndicatorOutput,
  type IndicatorParams,
  type OHLCV,
} from "./index";

/**
 * Average True Range (Wilder). True range seeds a Wilder-smoothed average over
 * `period` bars. Sub-panel oscillator. `null` until `period` true ranges are
 * available (first value at index `period`).
 */
export function atr(data: OHLCV[], params: IndicatorParams = {}): IndicatorOutput {
  const period = positiveInt(params.period, 14);
  const tr = data.map((_, i) => trueRange(data, i));
  return { atr: toSeries(data, wilderSmooth(tr, period, 1)) };
}

export const definition: IndicatorDefinition = {
  id: "atr",
  label: "Average True Range",
  description: "Wilder average true range — volatility of the bar range.",
  defaultParams: { period: 14 },
  outputs: ["atr"],
  pane: "sub",
  apply: atr,
};
