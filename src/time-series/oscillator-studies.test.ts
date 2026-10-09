import { describe, expect, test } from "bun:test";
import { createTestResolvedSeries, createTestSeriesPoint } from "../test-support/time-series";
import { averageDirectionalIndex, resolveStudies, stochastic } from "./studies";
import type { ChartStudySpec, TimeSeriesPoint } from "./types";

function bars(count: number, bar: (index: number) => { high: number; low: number; close: number }) {
  return Array.from({ length: count }, (_, index) => bar(index));
}

describe("stochastic and ADX", () => {
  test("a rising series pins %K at the top of the range and ADX to the upside", () => {
    const rising = bars(9, (index) => ({ high: index + 1, low: index, close: index + 1 }));
    const oscillator = stochastic(rising, 3, 3);
    expect(oscillator.k.map((point) => point.value)).toEqual([100, 100, 100, 100, 100, 100, 100]);
    expect(oscillator.d.map((point) => point.index)).toEqual([4, 5, 6, 7, 8]);
    expect(oscillator.d.every((point) => point.value === 100)).toBe(true);

    const directional = averageDirectionalIndex(rising, 3);
    expect(directional.plusDI.every((point) => point.value === 100)).toBe(true);
    expect(directional.minusDI.every((point) => point.value === 0)).toBe(true);
    expect(directional.adx[0]).toEqual({ index: 5, value: 100 });
    expect(directional.adx.at(-1)?.value).toBe(100);
  });

  test("a flat range is %K 50 and an ADX of zero", () => {
    const flat = bars(9, () => ({ high: 11, low: 9, close: 10 }));
    const oscillator = stochastic(flat, 3, 3);
    expect(oscillator.k.every((point) => point.value === 50)).toBe(true);
    expect(oscillator.d.every((point) => point.value === 50)).toBe(true);

    const directional = averageDirectionalIndex(flat, 3);
    expect(directional.plusDI.every((point) => point.value === 0)).toBe(true);
    expect(directional.minusDI.every((point) => point.value === 0)).toBe(true);
    expect(directional.adx.every((point) => point.value === 0)).toBe(true);
    expect(directional.adx.length).toBeGreaterThan(0);
  });

  test("the lower panel reads high, low and close, not the scalar", () => {
    const points: TimeSeriesPoint[] = bars(9, (index) => ({ high: index + 1, low: index, close: index + 1 }))
      .map((bar, index) => ({
        ...createTestSeriesPoint(new Date(Date.UTC(2024, 0, index + 1)), 1),
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
    const input = createTestResolvedSeries({ id: "price", label: "TEST", points });
    const study = (kind: "stochastic" | "adx", parameters: ChartStudySpec["parameters"]): ChartStudySpec => ({
      id: kind, kind, inputSeriesIds: ["price"], parameters, panelId: kind, axis: "auto",
    });
    const result = resolveStudies([input], [
      study("stochastic", { period: 3, smooth: 3 }),
      study("adx", { period: 3 }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.series.find((series) => series.id === "stochastic:k")).toMatchObject({
      panelId: "stochastic", unitGroup: "oscillator-0-100",
    });
    expect(result.series.find((series) => series.id === "stochastic:k")?.points.every((point) => point.value === 100)).toBe(true);
    expect(result.series.find((series) => series.id === "stochastic:d")?.points[0]?.value).toBe(100);
    expect(result.series.find((series) => series.id === "adx:adx")?.points.at(-1)?.value).toBe(100);
    expect(result.series.find((series) => series.id === "adx:plus")?.panelId).toBe("adx");
    expect(result.series.find((series) => series.id === "adx:minus")?.points.at(-1)?.value).toBe(0);
  });
});
