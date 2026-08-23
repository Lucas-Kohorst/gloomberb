import {
  closePrice,
  positiveInt,
  smaArray,
  toSeries,
  type IndicatorDefinition,
  type IndicatorOutput,
  type IndicatorParams,
  type OHLCV,
} from "./index";

/**
 * Simple Moving Average — arithmetic mean of the close over a trailing window.
 * Overlays the price pane. `null` until `period` closes are available (and for
 * any window that contains a missing close).
 */
export function sma(data: OHLCV[], params: IndicatorParams = {}): IndicatorOutput {
  const period = positiveInt(params.period, 20);
  const closes = data.map((bar) => closePrice(bar) ?? Number.NaN);
  return { sma: toSeries(data, smaArray(closes, period)) };
}

export const definition: IndicatorDefinition = {
  id: "sma",
  label: "Simple Moving Average",
  description: "Arithmetic mean of the close price over a trailing window.",
  defaultParams: { period: 20 },
  outputs: ["sma"],
  pane: "overlay",
  apply: sma,
};
