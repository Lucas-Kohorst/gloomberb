import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  fetchWeatherUndergroundObservation,
  loadWeatherObservationWithFallback,
  normalizeWeatherUndergroundPayload,
  resetWeatherUndergroundCache,
  weatherUndergroundToObservation,
} from "./weather-underground";
import type { WeatherDailyObservation } from "./types";

const WU_FIXTURE = {
  stationID: "KHKO1",
  source: "weather-underground",
  observations: [
    {
      localDate: "2026-08-18",
      imperial: { maxTemp: 88, minTemp: 72, precipTotal: 0.1, snowfall: 0 },
    },
    {
      localDate: "2026-08-18",
      imperial: { maxTemp: 90, minTemp: 70, precipTotal: 0.25, snowfall: 0 },
    },
    {
      // wrong day, must be skipped
      localDate: "2026-08-19",
      imperial: { maxTemp: 99, minTemp: 60, precipTotal: 2, snowfall: 0 },
    },
  ],
};

describe("Weather Underground payload normalize", () => {
  test("aggregates max high, min low, and summed precip for the date", () => {
    const report = normalizeWeatherUndergroundPayload(WU_FIXTURE, "HKG", "2026-08-18");
    expect(report).toMatchObject({
      stationId: "HKG",
      pwsStationId: "KHKO1",
      date: "2026-08-18",
      maxTempF: 90,
      minTempF: 70,
      precipitationIn: 0.35,
      snowfallIn: null,
      status: "preliminary",
    });
  });

  test("falls back to metric block when imperial is absent", () => {
    const report = normalizeWeatherUndergroundPayload({
      observations: [
        { localDate: "2026-08-18", metric: { maxTemp: 32, minTemp: 22, precipTotal: 5 } },
      ],
    }, "HKG", "2026-08-18");
    expect(report?.maxTempF).toBe(32);
    expect(report?.minTempF).toBe(22);
    expect(report?.precipitationIn).toBe(5);
  });

  test("maps onto the shared daily observation as non-official", () => {
    const report = normalizeWeatherUndergroundPayload(WU_FIXTURE, "HKG", "2026-08-18")!;
    const observation = weatherUndergroundToObservation(report);
    expect(observation).toMatchObject({
      stationId: "HKG",
      date: "2026-08-18",
      maxTemp: 90,
      minTemp: 70,
      precipitation: 0.35,
      official: false,
      status: "preliminary",
    });
  });

  test("returns null for an empty or malformed payload", () => {
    expect(normalizeWeatherUndergroundPayload({}, "HKG", "2026-08-18")).toBeNull();
    expect(normalizeWeatherUndergroundPayload({ observations: [] }, "HKG", "2026-08-18")).toBeNull();
    expect(normalizeWeatherUndergroundPayload(null, "HKG", "2026-08-18")).toBeNull();
    expect(normalizeWeatherUndergroundPayload("nope", "HKG", "2026-08-18")).toBeNull();
  });

  test("returns null when no observations match the requested date", () => {
    const report = normalizeWeatherUndergroundPayload(
      { observations: [{ localDate: "2026-08-19", imperial: { maxTemp: 80 } }] },
      "HKG",
      "2026-08-18",
    );
    expect(report).toBeNull();
  });
});

describe("Weather Underground fetch", () => {
  afterEach(() => {
    setHttpFetchTransport(null);
    resetWeatherUndergroundCache();
  });

  test("returns null without an API key and never hits the network", async () => {
    let calls = 0;
    setHttpFetchTransport(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    expect(await fetchWeatherUndergroundObservation("HKG", "2026-08-18", null)).toBeNull();
    expect(calls).toBe(0);
  });

  test("fetches, normalizes, and caches a WU history payload", async () => {
    setHttpFetchTransport(async (url) => {
      expect(url).toContain("stationId=VHHH");
      expect(url).toContain("date=20260818");
      expect(url).toContain("apiKey=test-key");
      return new Response(JSON.stringify(WU_FIXTURE), { status: 200 });
    });
    const report = await fetchWeatherUndergroundObservation("HKG", "2026-08-18", "test-key", { now: 1_000 });
    expect(report).toMatchObject({ stationId: "HKG", maxTempF: 90, precipitationIn: 0.35 });
    let calls = 0;
    setHttpFetchTransport(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const cached = await fetchWeatherUndergroundObservation("HKG", "2026-08-18", "test-key", { now: 2_000 });
    expect(cached).toEqual(report);
    expect(calls).toBe(0);
  });

  test("returns null on a failed request without throwing", async () => {
    setHttpFetchTransport(async () => new Response("nope", { status: 502 }));
    expect(await fetchWeatherUndergroundObservation("HKG", "2026-08-18", "test-key")).toBeNull();
  });
});

describe("Weather Underground fallback wrapper", () => {
  afterEach(() => {
    setHttpFetchTransport(null);
    resetWeatherUndergroundCache();
  });

  test("returns the primary observation when it succeeds", async () => {
    const primary: WeatherDailyObservation = {
      stationId: "HKG",
      date: "2026-08-18",
      maxTemp: 89,
      minTemp: 71,
      precipitation: 0.3,
      snowfall: null,
      status: "official",
      official: true,
    };
    const result = await loadWeatherObservationWithFallback(
      "HKG",
      "2026-08-18",
      "test-key",
      async () => primary,
    );
    expect(result).toEqual({ observation: primary, source: "primary" });
  });

  test("falls back to WU when the primary returns null", async () => {
    setHttpFetchTransport(async (url) => {
      expect(url).toContain("apiKey=test-key");
      return new Response(JSON.stringify(WU_FIXTURE), { status: 200 });
    });
    const result = await loadWeatherObservationWithFallback(
      "HKG",
      "2026-08-18",
      "test-key",
      async () => null,
    );
    expect(result.source).toBe("fallback");
    expect(result.observation).toMatchObject({
      stationId: "HKG",
      maxTemp: 90,
      minTemp: 70,
      precipitation: 0.35,
      official: false,
    });
  });

  test("reports none when the primary fails and no API key is set", async () => {
    const result = await loadWeatherObservationWithFallback(
      "HKG",
      "2026-08-18",
      null,
      async () => null,
    );
    expect(result).toEqual({ observation: null, source: "none" });
  });

  test("falls back when the primary rejects", async () => {
    setHttpFetchTransport(async () => new Response(JSON.stringify(WU_FIXTURE), { status: 200 }));
    const result = await loadWeatherObservationWithFallback(
      "HKG",
      "2026-08-18",
      "test-key",
      async () => {
        throw new Error("primary down");
      },
    );
    expect(result.source).toBe("fallback");
    expect(result.observation?.maxTemp).toBe(90);
  });
});
