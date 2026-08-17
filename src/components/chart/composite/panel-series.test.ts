import { describe, expect, test } from "bun:test";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import { groupSeriesByPanelId } from "./panel-series";

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

describe("groupSeriesByPanelId", () => {
  test("groups by panelId", () => {
    const a = series("a", "main");
    const b = series("b", "volume");
    const c = series("c", "main");
    const grouped = groupSeriesByPanelId([a, b, c]);
    expect(grouped.get("main")).toEqual([a, c]);
    expect(grouped.get("volume")).toEqual([b]);
  });

  test("reuses panel array identity when members are unchanged", () => {
    const a = series("a", "main");
    const b = series("b", "main");
    const first = groupSeriesByPanelId([a, b]);
    const second = groupSeriesByPanelId([a, b], first);
    expect(second.get("main")).toBe(first.get("main"));
  });

  test("allocates a new panel array when membership changes", () => {
    const a = series("a", "main");
    const b = series("b", "main");
    const first = groupSeriesByPanelId([a]);
    const second = groupSeriesByPanelId([a, b], first);
    expect(second.get("main")).not.toBe(first.get("main"));
    expect(second.get("main")).toEqual([a, b]);
  });
});
