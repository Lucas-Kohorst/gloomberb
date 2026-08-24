import {
  isFiniteNumber,
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
 * Average Directional Index (Wilder). Computes +DM/−DM and true range, Wilder
 * smooths them into +DI/−DI, derives DX, then Wilder smooths DX into ADX over
 * the same `period`. Sub-panel oscillator. +DI/−DI start at index `period`;
 * ADX starts at index `2*period − 1`.
 */
export function adx(data: OHLCV[], params: IndicatorParams = {}): IndicatorOutput {
  const period = positiveInt(params.period, 14);
  const plusDM: number[] = new Array(data.length).fill(Number.NaN);
  const minusDM: number[] = new Array(data.length).fill(Number.NaN);
  for (let i = 1; i < data.length; i += 1) {
    const high = data[i]!.high;
    const prevHigh = data[i - 1]!.high;
    const low = data[i]!.low;
    const prevLow = data[i - 1]!.low;
    if (!isFiniteNumber(high) || !isFiniteNumber(prevHigh) || !isFiniteNumber(low) || !isFiniteNumber(prevLow)) {
      continue;
    }
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }
  const tr = data.map((_, i) => trueRange(data, i));
  const smoothedPlusDM = wilderSmooth(plusDM, period, 1);
  const smoothedMinusDM = wilderSmooth(minusDM, period, 1);
  const smoothedTR = wilderSmooth(tr, period, 1);
  const plusDI: (number | null)[] = new Array(data.length).fill(null);
  const minusDI: (number | null)[] = new Array(data.length).fill(null);
  const dx: number[] = new Array(data.length).fill(Number.NaN);
  for (let i = 0; i < data.length; i += 1) {
    const sTR = smoothedTR[i];
    const sPlus = smoothedPlusDM[i];
    const sMinus = smoothedMinusDM[i];
    if (sTR === null || sPlus === null || sMinus === null || sTR === 0) continue;
    const pdi = (100 * sPlus) / sTR;
    const mdi = (100 * sMinus) / sTR;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const sum = pdi + mdi;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
  }
  const adxValues = wilderSmooth(dx, period, 0).map((value) =>
    value === null || !isFiniteNumber(value) ? null : value,
  );
  return {
    adx: toSeries(data, adxValues),
    plusDI: toSeries(data, plusDI),
    minusDI: toSeries(data, minusDI),
  };
}

export const definition: IndicatorDefinition = {
  id: "adx",
  label: "Average Directional Index",
  description: "Wilder ADX with +DI/−DI — trend strength regardless of direction.",
  defaultParams: { period: 14 },
  outputs: ["adx", "plusDI", "minusDI"],
  pane: "sub",
  apply: adx,
};
