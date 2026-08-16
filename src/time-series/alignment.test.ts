import { describe, expect, test } from "bun:test";
import { alignTimeSeries } from "./alignment";
import type { ResolvedSeries, TimeSeriesPoint } from "./types";

function point(date: string, value: number, availableAt?: string): TimeSeriesPoint {
  const observedAt = new Date(`${date}T00:00:00Z`);
  return {
    date: observedAt,
    observedAt,
    availableAt: availableAt ? new Date(`${availableAt}T00:00:00Z`) : undefined,
    value,
  };
}

function series(
  id: string,
  points: TimeSeriesPoint[],
  interpolation: ResolvedSeries["interpolation"] = "none",
): ResolvedSeries {
  return {
    id,
    label: id,
    color: "#fff",
    unit: "value",
    unitGroup: "value",
    nativeFrequency: "daily",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation,
    points,
  };
}

function timelineDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

const DAY_MS = 86_400_000;

describe("alignTimeSeries carry-forward", () => {
  test("fills a low-frequency series between high-frequency timeline rows", () => {
    const daily = series("daily", [
      point("2024-01-01", 1),
      point("2024-01-02", 2),
      point("2024-01-03", 3),
      point("2024-01-04", 4),
      point("2024-01-05", 5),
    ]);
    const monthly = series("monthly", [
      point("2024-01-01", 100),
      point("2024-02-01", 200),
    ]);

    const rows = alignTimeSeries([daily, monthly], {
      carryForward: true,
      timeline: [
        timelineDate("2024-01-01"),
        timelineDate("2024-01-02"),
        timelineDate("2024-01-03"),
        timelineDate("2024-01-04"),
        timelineDate("2024-01-05"),
      ],
    });

    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2024-01-01",
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
    ]);

    // Daily series has exact matches on every row.
    expect(rows.map((r) => r.values["daily"]?.value)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.values["daily"]?.carried === false)).toBe(true);

    // Monthly series: exact on Jan 1, carried forward for the remaining days.
    expect(rows.map((r) => r.values["monthly"]?.value)).toEqual([100, 100, 100, 100, 100]);
    expect(rows[0]!.values["monthly"]?.carried).toBe(false);
    expect(rows.slice(1).every((r) => r.values["monthly"]?.carried === true)).toBe(true);
  });

  test("returns null when the gap exceeds maxCarryMilliseconds", () => {
    const s = series("sparse", [
      point("2024-01-01", 100),
      point("2024-01-10", 200),
    ]);

    const rows = alignTimeSeries([s], {
      carryForward: true,
      maxCarryMilliseconds: 2 * DAY_MS,
      timeline: [
        timelineDate("2024-01-01"),
        timelineDate("2024-01-03"),
        timelineDate("2024-01-05"),
        timelineDate("2024-01-10"),
      ],
    });

    // Jan 1: exact match.
    expect(rows[0]!.values["sparse"]?.value).toBe(100);
    expect(rows[0]!.values["sparse"]?.carried).toBe(false);

    // Jan 3: age = 2 days, within the 2-day limit.
    expect(rows[1]!.values["sparse"]?.value).toBe(100);
    expect(rows[1]!.values["sparse"]?.carried).toBe(true);

    // Jan 5: age = 4 days, exceeds the 2-day limit → null, not stale.
    expect(rows[2]!.values["sparse"]).toBeNull();

    // Jan 10: exact match.
    expect(rows[3]!.values["sparse"]?.value).toBe(200);
    expect(rows[3]!.values["sparse"]?.carried).toBe(false);
  });

  test("returns null when no point precedes the first timeline timestamp", () => {
    const s = series("late", [
      point("2024-01-03", 42),
    ]);

    const rows = alignTimeSeries([s], {
      carryForward: true,
      timeline: [
        timelineDate("2024-01-01"),
        timelineDate("2024-01-02"),
        timelineDate("2024-01-03"),
      ],
    });

    expect(rows[0]!.values["late"]).toBeNull();
    expect(rows[1]!.values["late"]).toBeNull();
    expect(rows[2]!.values["late"]?.value).toBe(42);
    expect(rows[2]!.values["late"]?.carried).toBe(false);
  });

  test("applies carry-forward by default for step-after interpolation", () => {
    const s = series("step", [
      point("2024-01-01", 100),
      point("2024-01-03", 200),
    ], "step-after");

    const rows = alignTimeSeries([s], {
      // No explicit carryForward — step-after enables it by default.
      timeline: [
        timelineDate("2024-01-01"),
        timelineDate("2024-01-02"),
        timelineDate("2024-01-03"),
      ],
    });

    expect(rows[0]!.values["step"]?.value).toBe(100);
    expect(rows[0]!.values["step"]?.carried).toBe(false);

    // Jan 2 has no exact point, but step-after carries Jan 1 forward.
    expect(rows[1]!.values["step"]?.value).toBe(100);
    expect(rows[1]!.values["step"]?.carried).toBe(true);

    expect(rows[2]!.values["step"]?.value).toBe(200);
    expect(rows[2]!.values["step"]?.carried).toBe(false);
  });
});
