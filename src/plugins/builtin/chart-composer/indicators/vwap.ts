import {
  isFiniteNumber,
  toSeries,
  type IndicatorDefinition,
  type IndicatorOutput,
  type IndicatorParams,
  type OHLCV,
} from "./index";

/** Typical price (HLC3); falls back to close when HLC is incomplete. */
function typicalPrice(bar: OHLCV): number | null {
  if (isFiniteNumber(bar.high) && isFiniteNumber(bar.low) && isFiniteNumber(bar.close)) {
    return (bar.high + bar.low + bar.close) / 3;
  }
  return isFiniteNumber(bar.close) ? bar.close : null;
}

function sessionKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

/**
 * Session VWAP — cumulative volume-weighted typical price, reset at each UTC
 * day. Overlays the price pane. Bars without volume (or a computable typical
 * price) yield `null` and do not advance the cumulative totals.
 */
export function vwap(data: OHLCV[], _params: IndicatorParams = {}): IndicatorOutput {
  const values: (number | null)[] = new Array(data.length).fill(null);
  let day: string | null = null;
  let cumulativePv = 0;
  let cumulativeVolume = 0;
  data.forEach((bar, index) => {
    const price = typicalPrice(bar);
    const volume = isFiniteNumber(bar.volume) ? bar.volume : null;
    if (price === null || volume === null || volume <= 0) {
      values[index] = null;
      return;
    }
    const key = sessionKey(bar.date);
    if (day !== key) {
      day = key;
      cumulativePv = 0;
      cumulativeVolume = 0;
    }
    cumulativePv += price * volume;
    cumulativeVolume += volume;
    values[index] = cumulativePv / cumulativeVolume;
  });
  return { vwap: toSeries(data, values) };
}

export const definition: IndicatorDefinition = {
  id: "vwap",
  label: "VWAP",
  description: "Session volume-weighted average price (HLC3, resets per UTC day).",
  defaultParams: {},
  outputs: ["vwap"],
  pane: "overlay",
  apply: vwap,
};
