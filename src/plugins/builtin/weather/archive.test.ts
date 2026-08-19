import { describe, expect, test } from "bun:test";
import { EMPTY_WEATHER_ARCHIVE, mergeWeatherArchive } from "./archive";

describe("weather forecast archive", () => {
  test("freezes the first pending high as the forecast and later fills settlement", () => {
    const first = mergeWeatherArchive(EMPTY_WEATHER_ARCHIVE, {
      today: "2026-08-19",
      now: 1,
      observations: [{ stationId: "LAX", date: "2026-08-19", high: 83, official: false }],
    });
    expect(first.records[0]).toMatchObject({
      forecastHigh: 83,
      settlementHigh: null,
    });
    const second = mergeWeatherArchive(first, {
      today: "2026-08-20",
      now: 2,
      observations: [{ stationId: "LAX", date: "2026-08-19", high: 82, official: true }],
    });
    expect(second.records[0]).toMatchObject({
      forecastHigh: 83,
      settlementHigh: 82,
    });
  });

  test("does not treat an official print as the forecast", () => {
    const next = mergeWeatherArchive(EMPTY_WEATHER_ARCHIVE, {
      today: "2026-08-19",
      observations: [{ stationId: "LAX", date: "2026-08-18", high: 82, official: true }],
    });
    expect(next.records[0]).toMatchObject({
      forecastHigh: null,
      settlementHigh: 82,
    });
  });

  test("stores the first open Kalshi implied and ignores settled 0/1 books", () => {
    const open = mergeWeatherArchive(EMPTY_WEATHER_ARCHIVE, {
      today: "2026-08-19",
      implied: [{ stationId: "LAX", date: "2026-08-19", impliedHigh: 82.9, eventOpen: true }],
    });
    const settled = mergeWeatherArchive(open, {
      today: "2026-08-20",
      implied: [{ stationId: "LAX", date: "2026-08-19", impliedHigh: 82.5, eventOpen: false }],
    });
    expect(settled.records[0]?.impliedHigh).toBe(82.9);
  });
});
