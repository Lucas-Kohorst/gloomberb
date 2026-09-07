import { describe, expect, test } from "bun:test";
import { summarizeBookRows } from "./stats";
import type { WxBookDayRow } from "./types";

describe("wx book range summary", () => {
  test("computes hit rate and skips pending settlement days", () => {
    const rows: WxBookDayRow[] = [
      {
        date: "2026-08-30",
        favoriteLabel: "≤76",
        favoriteMidpoint: 75,
        favoriteYes: 0.4,
        asosHighF: 74,
        settlementF: 84,
        hit: false,
        bookAvailable: true,
      },
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
        favoriteLabel: "76–77",
        favoriteMidpoint: 76.5,
        favoriteYes: 0.52,
        asosHighF: null,
        settlementF: null,
        hit: null,
        bookAvailable: true,
      },
    ];
    const summary = summarizeBookRows(rows);
    expect(summary.samples).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.hitRate).toBe(0.5);
  });
});
