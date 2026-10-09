import { describe, expect, test } from "bun:test";
import { nowcastFromCsv, parseFredGraphCsv } from "./client";
import { NOWCAST_SERIES } from "./model";

const CSV = [
  "observation_date,NFCI",
  "2026-09-18,-0.524",
  "2026-09-25,.",
  "2026-10-02,-0.494",
  "",
].join("\n");

describe("nowcast csv", () => {
  test("parses a small csv, keeping a missing print", () => {
    expect(parseFredGraphCsv(`\uFEFF${CSV.replace(/\n/g, "\r\n")}`)).toEqual([
      { date: "2026-09-18", value: -0.524 },
      { date: "2026-09-25", value: null },
      { date: "2026-10-02", value: -0.494 },
    ]);
  });

  test("html and a header with no rows are not observations", () => {
    expect(parseFredGraphCsv("<!DOCTYPE html><html><body>blocked</body></html>")).toEqual([]);
    expect(parseFredGraphCsv("<html>no series</html>")).toEqual([]);
    expect(parseFredGraphCsv("")).toEqual([]);
    expect(parseFredGraphCsv("observation_date,NFCI\n")).toEqual([]);
  });

  test("the row is the latest number and the one before it", () => {
    const series = NOWCAST_SERIES.find((entry) => entry.id === "NFCI")!;
    expect(nowcastFromCsv(series, CSV)).toMatchObject({
      measure: "Financial conditions",
      asOf: "2026-10-02",
      latest: -0.494,
      previous: -0.524,
    });
    expect(nowcastFromCsv(series, CSV)?.change).toBeCloseTo(0.03, 10);
    expect(nowcastFromCsv(series, "observation_date,NFCI\n2026-10-02,-0.494\n")).toMatchObject({
      latest: -0.494,
      previous: null,
      change: null,
    });
    expect(nowcastFromCsv(series, "<html></html>")).toBeNull();
  });
});
