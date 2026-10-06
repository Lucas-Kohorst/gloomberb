import { expect, test } from "bun:test";
import { latestRate, rateChangeBp, yieldStat, type BriefYieldRow } from "./rates";

test("latestRate keeps the newest print and the one before it", () => {
  expect(latestRate([
    { date: "2026-10-01", value: 4.1 },
    { date: "2026-10-02", value: null },
    { date: "2026-10-03", value: 4.18 },
  ])).toEqual({ value: 4.18, previous: 4.1 });
  expect(latestRate([{ date: "2026-10-03", value: 6.3 }])).toEqual({ value: 6.3, previous: null });
  expect(latestRate([])).toBeNull();
});

test("rateChangeBp is the rounded move in basis points", () => {
  expect(rateChangeBp(4.21, 4.19)).toBe(2);
  expect(rateChangeBp(4.19, 4.21)).toBe(-2);
  expect(rateChangeBp(6.3, null)).toBeNull();
});

test("yieldStat prints the level and the basis-point move", () => {
  const row: BriefYieldRow = { id: "us10y", label: "10Y", level: { value: 4.21, previous: 4.19 } };
  expect(yieldStat(row)).toEqual({ id: "us10y", label: "10Y", value: "4.21%", detail: "+2bp", tone: "positive" });
  expect(yieldStat({ id: "mtg30", label: "30Y MTG", level: null })).toEqual({ id: "mtg30", label: "30Y MTG", value: "--" });
});
