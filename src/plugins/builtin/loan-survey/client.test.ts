import { describe, expect, test } from "bun:test";
import { parseLoanSurveyCsv } from "./client";

describe("parseLoanSurveyCsv", () => {
  test("reads observation rows, including a missing print and a negative value", () => {
    const rows = parseLoanSurveyCsv([
      "\uFEFFobservation_date,DRTSCILM",
      "2025-10-01,6.5",
      "2026-01-01,.",
      "2026-04-01,8.1",
      "2026-07-01,0.0",
      "2021-07-01,-32.4",
      "not a row",
    ].join("\n"));
    expect(rows).toEqual([
      { date: "2025-10-01", value: 6.5 },
      { date: "2026-01-01", value: null },
      { date: "2026-04-01", value: 8.1 },
      { date: "2026-07-01", value: 0 },
      { date: "2021-07-01", value: -32.4 },
    ]);
  });

  test("returns no rows for a header-only table and rejects a page", () => {
    expect(parseLoanSurveyCsv("observation_date,DRTSCLCC\n")).toEqual([]);
    expect(() => parseLoanSurveyCsv("<!DOCTYPE html><html></html>")).toThrow("Response was not a table");
  });
});
