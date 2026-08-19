import { describe, expect, test } from "bun:test";
import { mergeWeatherArchive, EMPTY_WEATHER_ARCHIVE } from "./archive";
import { buildWeatherAccuracyReport, formatBias, formatHitRate } from "./report";

describe("weather accuracy report", () => {
  test("scores hit rate, MAE, and signed bias by city", () => {
    let archive = EMPTY_WEATHER_ARCHIVE;
    archive = mergeWeatherArchive(archive, {
      today: "2026-08-19",
      observations: [
        { stationId: "LAX", date: "2026-08-17", high: 83, official: false },
        { stationId: "LAX", date: "2026-08-18", high: 82, official: false },
        { stationId: "MIA", date: "2026-08-17", high: 90, official: false },
      ],
    });
    archive = mergeWeatherArchive(archive, {
      today: "2026-08-19",
      observations: [
        { stationId: "LAX", date: "2026-08-17", high: 83, official: true },
        { stationId: "LAX", date: "2026-08-18", high: 81, official: true },
        { stationId: "MIA", date: "2026-08-17", high: 92, official: true },
      ],
    });
    const report = buildWeatherAccuracyReport(archive, "twc");
    expect(report.samples).toBe(3);
    expect(report.hitRate).toBeCloseTo(1 / 3, 5);
    expect(report.mae).toBeCloseTo(1, 5);
    expect(report.bias).toBeCloseTo(1 / 3, 5);
    const lax = report.cities.find((row) => row.stationId === "LAX");
    expect(lax?.samples).toBe(2);
    expect(lax?.hitRate).toBe(0.5);
    expect(formatHitRate(report.hitRate)).toBe("33%");
    expect(formatBias(report.bias)).toBe("+0.3");
  });

  test("scores Kalshi implied against settlement separately", () => {
    const archive = mergeWeatherArchive(EMPTY_WEATHER_ARCHIVE, {
      today: "2026-08-19",
      implied: [{ stationId: "LAX", date: "2026-08-18", impliedHigh: 82.9, eventOpen: true }],
      observations: [{ stationId: "LAX", date: "2026-08-18", high: 83, official: true }],
    });
    const report = buildWeatherAccuracyReport(archive, "implied");
    expect(report.samples).toBe(1);
    expect(report.hitRate).toBe(1);
    expect(report.mae).toBeCloseTo(0.1, 5);
  });
});
