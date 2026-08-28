import { describe, expect, test } from "bun:test";
import { aggregateNwsDaily, parseNwsObservationCollection, parseNwsObservationFeature } from "./parse";
import type { NwsObservation } from "./types";

const KLAX_FEATURE = {
  id: "https://api.weather.gov/stations/KLAX/observations/2026-08-19T18:53:00+00:00",
  type: "Feature",
  properties: {
    timestamp: "2026-08-19T18:53:00Z",
    temperature: { value: 27.8, unitCode: "wmoUnit:degC" },
    maxTemperatureLast24Hours: { value: 30, unitCode: "wmoUnit:degC" },
    minTemperatureLast24Hours: { value: 18, unitCode: "wmoUnit:degC" },
    precipitationLastHour: { value: 0, unitCode: "wmoUnit:mm" },
    qualityControl: { qualityControl: "passed" },
  },
};

const KLAX_FEATURE_2 = {
  id: "https://api.weather.gov/stations/KLAX/observations/2026-08-19T12:53:00+00:00",
  properties: {
    timestamp: "2026-08-19T12:53:00Z",
    temperature: { value: 22.2, unitCode: "wmoUnit:degC" },
    precipitationLastHour: { value: 2.54, unitCode: "wmoUnit:mm" },
    qualityControl: { qualityControl: "passed" },
  },
};

const KLAX_FEATURE_OTHER_DATE = {
  id: "https://api.weather.gov/stations/KLAX/observations/2026-08-20T00:53:00+00:00",
  properties: {
    timestamp: "2026-08-20T00:53:00Z",
    temperature: { value: 25, unitCode: "wmoUnit:degC" },
    qualityControl: { qualityControl: "passed" },
  },
};

describe("NWS observation parse", () => {
  test("converts Celsius temperatures to Fahrenheit and preserves both", () => {
    const obs = parseNwsObservationFeature(KLAX_FEATURE, "KLAX");
    expect(obs).toMatchObject({
      provider: "nws-observations",
      stationId: "KLAX",
      icao: "KLAX",
      timestamp: "2026-08-19T18:53:00Z",
      tempC: 27.8,
      tempF: 82,
      maxTempF24h: 86,
      minTempF24h: 64,
      precipIn: 0,
      qualityControl: "passed",
    });
    expect(obs?.sourceUrl).toContain("/observations/2026-08-19T18:53:00");
  });

  test("returns null for a feature without properties", () => {
    expect(parseNwsObservationFeature({ id: "x" }, "KLAX")).toBeNull();
    expect(parseNwsObservationFeature(null, "KLAX")).toBeNull();
  });

  test("parses a GeoJSON FeatureCollection into observation records", () => {
    const observations = parseNwsObservationCollection(
      { features: [KLAX_FEATURE, KLAX_FEATURE_2, KLAX_FEATURE_OTHER_DATE] },
      "KLAX",
    );
    expect(observations).toHaveLength(3);
    expect(observations[0]?.tempF).toBe(82);
    expect(observations[1]?.precipIn).toBe(0.1);
  });

  test("aggregates observations for a single date into daily max/min/precip", () => {
    const observations = parseNwsObservationCollection(
      { features: [KLAX_FEATURE, KLAX_FEATURE_2, KLAX_FEATURE_OTHER_DATE] },
      "KLAX",
    ) as NwsObservation[];
    const daily = aggregateNwsDaily(
      observations,
      "KLAX",
      "2026-08-19",
      1,
      "https://api.weather.gov/stations/KLAX/observations",
    );
    expect(daily).toMatchObject({
      provider: "nws-observations",
      stationId: "KLAX",
      icao: "KLAX",
      date: "2026-08-19",
      maxTempF: 82,
      minTempF: 72,
      precipIn: 0.1,
      sampleCount: 2,
      firstTimestamp: "2026-08-19T12:53:00Z",
      lastTimestamp: "2026-08-19T18:53:00Z",
    });
  });

  test("returns a zero-sample aggregate when no observations match the date", () => {
    const observations = parseNwsObservationCollection(
      { features: [KLAX_FEATURE_OTHER_DATE] },
      "KLAX",
    ) as NwsObservation[];
    const daily = aggregateNwsDaily(observations, "KLAX", "2026-08-19", 1, null);
    expect(daily.sampleCount).toBe(0);
    expect(daily.maxTempF).toBeNull();
    expect(daily.minTempF).toBeNull();
    expect(daily.precipIn).toBeNull();
  });
});
