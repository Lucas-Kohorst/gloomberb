import { describe, expect, test } from "bun:test";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import { reuseResolvedSeriesIdentity, reuseResolvedSeriesList } from "./panel-series";

function point(): TimeSeriesPoint {
  const date = new Date("2024-01-01T00:00:00.000Z");
  return { date, observedAt: date, value: 1 };
}

function series(id: string, panelId: string): ResolvedSeries {
  return {
    id,
    label: id,
    color: "#0f0",
    unit: "USD",
    unitGroup: "currency",
    nativeFrequency: "daily",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId,
    interpolation: "none",
    points: [point()],
  };
}

describe("reuseResolvedSeriesIdentity", () => {
  test("reuses the previous object when a parent clones identical series data", () => {
    const original = series("a", "main");
    const clone: ResolvedSeries = { ...original, points: original.points.map((entry) => ({ ...entry })) };
    expect(reuseResolvedSeriesIdentity(original, clone)).toBe(original);
  });

  test("keeps series identity when only the last bar close and time change", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const first: TimeSeriesPoint = { date: start, observedAt: start, value: 10, close: 10 };
    const second: TimeSeriesPoint = {
      date: new Date("2024-01-02T00:00:00.000Z"),
      observedAt: new Date("2024-01-02T00:00:00.000Z"),
      value: 11,
      close: 11,
    };
    const previous = series("a", "main");
    previous.points = [first, second];
    const nextLast: TimeSeriesPoint = {
      date: new Date("2024-01-02T00:00:01.000Z"),
      observedAt: new Date("2024-01-02T00:00:01.000Z"),
      value: 11.5,
      close: 11.5,
    };
    const next: ResolvedSeries = {
      ...previous,
      points: [first, nextLast],
    };
    expect(reuseResolvedSeriesIdentity(previous, next)).toBe(previous);
    expect(previous.points[1]).toBe(nextLast);
  });

  test("reuses the list identity when every member is reused", () => {
    const a = series("a", "main");
    const first = [a];
    const second = reuseResolvedSeriesList(first, [{ ...a, points: a.points.map((entry) => ({ ...entry })) }]);
    expect(second).toBe(first);
  });
});
