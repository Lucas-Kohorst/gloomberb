import { expect, test } from "bun:test";
import { appendQuoteToPriceReturnHistory, buildPriceReturnFields } from "./performance";
import { clipPriceHistoryToLineage, priceLineageStartMs } from "./price-lineage";
import type { PricePoint } from "../types/financials";

test("a year-long hole starts a new price lineage at the later bar", () => {
  const points = [
    { date: "2011-06-01" },
    { date: "2022-10-20" },
    { date: "2026-10-02" },
    { date: "2026-10-08" },
  ];
  expect(new Date(priceLineageStartMs(points)!).toISOString().slice(0, 10)).toBe("2026-10-02");
  expect(clipPriceHistoryToLineage(points).map((point) => point.date)).toEqual(["2026-10-02", "2026-10-08"]);
});

test("returns do not cross a reused ticker", () => {
  const history: PricePoint[] = [
    { date: new Date("2022-10-20T00:00:00Z"), close: 12.85 },
    { date: new Date("2018-10-20T00:00:00Z"), close: 8 },
  ];
  const series = appendQuoteToPriceReturnHistory(history, { price: 25.58, lastUpdated: Date.parse("2026-10-08T20:00:00Z") });
  const fields = buildPriceReturnFields(series);
  expect(fields.find((field) => field.id === "1Y")?.value).toBeNull();
  expect(fields.find((field) => field.id === "5Y")?.value).toBeNull();
  expect(series.map((point) => point.close)).toEqual([25.58]);
});

test("a continuous history keeps every bar", () => {
  const points = [{ date: "2026-09-01" }, { date: "2026-10-01" }, { date: "2026-10-08" }];
  expect(priceLineageStartMs(points)).toBeNull();
  expect(clipPriceHistoryToLineage(points)).toHaveLength(3);
});
