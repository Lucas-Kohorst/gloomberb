import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  kalshiWeatherCityForStation,
  kalshiWeatherCalibrationUrl,
  kalshiWeatherIndexUrl,
  latestCompleteKalshiWeatherPoint,
  loadKalshiWeatherCalibrations,
  loadKalshiWeatherIndex,
  normalizeKalshiWeatherCalibrationTimeline,
  normalizeKalshiWeatherIndex,
  resetKalshiWeatherCaches,
} from "./kalshi-index";

afterEach(() => {
  setHttpFetchTransport(null);
  resetKalshiWeatherCaches();
});

describe("Kalshi weather index", () => {
  test("normalizes complete and incomplete points without inventing zero", () => {
    const index = normalizeKalshiWeatherIndex({
      city: "miami",
      units: "fahrenheit",
      config_version: "miami-temperature-v1.0",
      timeseries: [
        { t: 1_725_000_000_000, status: "complete", v: 91.25, contributors: 3 },
        { t: 1_725_000_060, status: "pending", contributors: 2, stations: [{ station_id: "A" }] },
        { t: "bad", v: 80 },
      ],
    }, 42);
    expect(index.points).toHaveLength(2);
    expect(index.points[0]).toMatchObject({ valueF: 91.25, complete: true });
    expect(index.points[1]).toMatchObject({ valueF: null, complete: false, timestampMs: 1_725_000_060_000 });
    expect(latestCompleteKalshiWeatherPoint(index)?.valueF).toBe(91.25);
  });

  test("normalizes calibration records and skips malformed entries", () => {
    const timeline = normalizeKalshiWeatherCalibrationTimeline({
      city: "miami",
      units: "celsius",
      calibrations: [
        {
          config_version: "v2",
          effective_at_ms: 1_725_000_000_000,
          city_reference_c: 27.1,
          stations: [{ station_id: "MIA", weight: 0.7, offset_c: -0.2, update_note: "ok" }],
          change_reason: "weekly calibration",
        },
        { config_version: "missing-time" },
      ],
    }, 10);
    expect(timeline.calibrations).toHaveLength(1);
    expect(timeline.calibrations[0]).toMatchObject({
      configVersion: "v2",
      effectiveAtMs: 1_725_000_000_000,
      cityReferenceC: 27.1,
      changeReason: "weekly calibration",
    });
    expect(timeline.calibrations[0]!.stations[0]).toMatchObject({ stationId: "MIA", offsetC: -0.2 });
  });

  test("maps only explicitly supported stations and builds documented URLs", () => {
    expect(kalshiWeatherCityForStation("MIA")).toBe("miami");
    expect(kalshiWeatherCityForStation("LAX")).toBeNull();
    expect(kalshiWeatherIndexUrl("miami", { lastSeconds: 3600, detailed: true })).toContain("last_sec=3600");
    expect(kalshiWeatherIndexUrl("miami", { detailed: true })).toContain("detailed=true");
    expect(kalshiWeatherCalibrationUrl("miami")).toContain("/live_data/weather/miami/calibrations");
  });

  test("loads both endpoints through the shared transport and caches them", async () => {
    let calls = 0;
    setHttpFetchTransport(async (url) => {
      calls += 1;
      if (url.includes("/calibrations")) {
        return new Response(JSON.stringify({ city: "miami", units: "celsius", calibrations: [] }));
      }
      return new Response(JSON.stringify({ city: "miami", units: "fahrenheit", timeseries: [] }));
    });
    await loadKalshiWeatherIndex("miami", { now: 100 });
    await loadKalshiWeatherIndex("miami", { now: 100 });
    await loadKalshiWeatherCalibrations("miami", 100);
    await loadKalshiWeatherCalibrations("miami", 100);
    expect(calls).toBe(2);
  });
});
