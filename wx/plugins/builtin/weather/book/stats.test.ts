import { describe, expect, test } from "bun:test";
import { pearson, runningMaxAtCutoff, summarizeBookRows } from "./stats";
import type { WxBookDayRow } from "./types";

describe("wx book stats", () => {
  test("pearson of identical series is 1", () => {
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 8);
  });

  test("running max stops at the cutoff", () => {
    expect(runningMaxAtCutoff(
      [
        { t: 1, tempF: 70 },
        { t: 2, tempF: 76 },
        { t: 3, tempF: 79 },
      ],
      2,
    )).toBe(76);
  });

  test("hit rate ignores days without a settlement", () => {
    const rows: WxBookDayRow[] = [
      {
        date: "2026-08-31",
        favoriteLabel: "78–79",
        favoriteMidpoint: 78.5,
        favoriteYes: 0.58,
        asosHighF: 78.8,
        settlementF: 79,
        hit: true,
        bookAvailable: true,
      },
      {
        date: "2026-09-01",
        favoriteLabel: "≤76",
        favoriteMidpoint: 75,
        favoriteYes: 0.4,
        asosHighF: null,
        settlementF: null,
        hit: null,
        bookAvailable: true,
      },
    ];
    const summary = summarizeBookRows(rows);
    expect(summary.samples).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.hitRate).toBe(1);
  });
});
