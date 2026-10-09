import { describe, expect, test } from "bun:test";
import { CREDIT_SERIES, CREDIT_YIELD_SERIES, normalizeCreditSeries, normalizeCreditYieldSeries } from "./model";

function payload(overrides: Record<string, unknown> = {}, observations: Array<{ date: string; value: number | null }> = [
  { date: "2026-08-17", value: 0.81 },
  { date: "2026-08-14", value: 0.8 },
  { date: "2026-08-16", value: null },
]) {
  return {
    observations,
    info: {
      id: "BAMLC0A0CM",
      title: "ICE BofA US Corporate Index Option-Adjusted Spread",
      units: "Percent",
      frequency: "Daily, Close",
      seasonalAdjustment: "Not Seasonally Adjusted",
      source: "",
      notes: "",
      ...overrides,
    },
  };
}

describe("normalizeCreditSeries", () => {
  test("converts the official percent OAS to basis points", () => {
    const row = normalizeCreditSeries(CREDIT_SERIES[0], payload(), true);

    expect(row).toMatchObject({
      label: "US IG",
      oasBp: 81,
      dailyChangeBp: 1,
      date: "2026-08-17",
      units: "Percent",
      frequency: "Daily, Close",
      stale: true,
    });
  });

  test("ranks the latest spread within the year before it, not the whole fetched history", () => {
    const row = normalizeCreditSeries(CREDIT_SERIES[0], payload({}, [
      { date: "2025-08-01", value: 3 },
      { date: "2025-08-20", value: 0.7 },
      { date: "2026-02-02", value: 0.9 },
      { date: "2026-08-17", value: 0.8 },
    ]));

    expect(row.history.map((point) => point.date)).toEqual(["2025-08-20", "2026-02-02", "2026-08-17"]);
    expect(row).toMatchObject({ percentile1Y: 50, rangeLowBp: 70, rangeHighBp: 90 });
  });

  test("rejects metadata that would make spread normalization misleading", () => {
    expect(() => normalizeCreditSeries(CREDIT_SERIES[0], payload({ units: "Index" }))).toThrow("unexpected FRED metadata");
    expect(() => normalizeCreditSeries(CREDIT_SERIES[0], payload({ title: "Corporate Effective Yield" }))).toThrow("unexpected FRED metadata");
    expect(() => normalizeCreditSeries(CREDIT_SERIES[0], payload({ id: "BAMLH0A0HYM2" }))).toThrow("unexpected FRED metadata");
  });
});

function yieldPayload(overrides: Record<string, unknown> = {}, treasuryReady = true) {
  return {
    observations: [
      { date: "2026-08-17", value: 5.1 },
      { date: "2026-08-14", value: 5.02 },
      { date: "2026-08-16", value: null },
    ],
    info: {
      id: "BAMLC0A0CMEY",
      title: treasuryReady ? "ICE BofA US Corporate Index Effective Yield" : "ICE BofA US Corporate Index Option-Adjusted Spread",
      units: "Percent",
      frequency: "Daily, Close",
      seasonalAdjustment: "Not Seasonally Adjusted",
      source: "",
      notes: "",
      ...overrides,
    },
  };
}

describe("normalizeCreditYieldSeries", () => {
  test("keeps the yield in percent, states the daily move in basis points, and subtracts the 10-year", () => {
    const row = normalizeCreditYieldSeries(CREDIT_YIELD_SERIES[0], yieldPayload(), 4.2, true);

    expect(row).toMatchObject({
      label: "US IG yield",
      seriesId: "BAMLC0A0CMEY",
      yieldPct: 5.1,
      dailyChangeBp: 8,
      spreadVs10YBp: 90,
      date: "2026-08-17",
      units: "Percent",
      stale: true,
    });
  });

  test("leaves the treasury spread blank when the 10-year is missing", () => {
    const row = normalizeCreditYieldSeries(CREDIT_YIELD_SERIES[1], {
      ...yieldPayload(),
      info: { ...yieldPayload().info, id: "BAMLH0A0HYM2EY", title: "ICE BofA US High Yield Index Effective Yield" },
    }, null);

    expect(row.yieldPct).toBe(5.1);
    expect(row.dailyChangeBp).toBe(8);
    expect(row.spreadVs10YBp).toBeNull();
  });

  test("accepts a yield title the OAS check rejects", () => {
    const body = yieldPayload({ title: "Corporate Effective Yield" });
    expect(() => normalizeCreditSeries(CREDIT_SERIES[0], body)).toThrow("unexpected FRED metadata");
    expect(normalizeCreditYieldSeries(CREDIT_YIELD_SERIES[0], body, null).yieldPct).toBe(5.1);
  });

  test("rejects an id, unit, or title that is not this yield", () => {
    expect(() => normalizeCreditYieldSeries(CREDIT_YIELD_SERIES[0], yieldPayload({ units: "Index" }), null)).toThrow("unexpected yield metadata");
    expect(() => normalizeCreditYieldSeries(CREDIT_YIELD_SERIES[0], yieldPayload({ id: "BAMLC0A0CM" }), null)).toThrow("unexpected yield metadata");
    expect(() => normalizeCreditYieldSeries(CREDIT_YIELD_SERIES[0], yieldPayload({}, false), null)).toThrow("unexpected yield metadata");
  });
});
