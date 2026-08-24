import {
  closePrice,
  isFiniteNumber,
  positiveInt,
  smaArray,
  stddev,
  toSeries,
  type IndicatorDefinition,
  type IndicatorOutput,
  type IndicatorParams,
  type OHLCV,
} from "./index";

/**
 * Bollinger Bands — `period` SMA middle band with `stdDev` standard-deviation
 * upper/lower bands (population standard deviation over the same window).
 * Overlays the price pane. All three bands are `null` until `period` closes
 * are available and for any window that contains a missing close.
 */
export function bollinger(data: OHLCV[], params: IndicatorParams = {}): IndicatorOutput {
  const period = positiveInt(params.period, 20);
  const deviations = isFiniteNumber(params.stdDev) && params.stdDev > 0 ? params.stdDev : 2;
  const closes = data.map((bar) => closePrice(bar) ?? Number.NaN);
  const middle = smaArray(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i += 1) {
    const mid = middle[i];
    if (mid === null) continue;
    const window = closes.slice(i - period + 1, i + 1);
    const dev = stddev(window, mid) * deviations;
    upper[i] = mid + dev;
    lower[i] = mid - dev;
  }
  return {
    upper: toSeries(data, upper),
    middle: toSeries(data, middle),
    lower: toSeries(data, lower),
  };
}

export const definition: IndicatorDefinition = {
  id: "bollinger",
  label: "Bollinger Bands",
  description: "SMA middle band with standard-deviation upper/lower bands.",
  defaultParams: { period: 20, stdDev: 2 },
  outputs: ["upper", "middle", "lower"],
  pane: "overlay",
  apply: bollinger,
};
