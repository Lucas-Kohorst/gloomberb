import { describe, expect, test } from "bun:test";
import { parseNwsStationObservations } from "./parse";

const payload = {
  features: [{
    id: "https://api.weather.gov/stations/KATL/observations/example",
    properties: {
      timestamp: "2026-08-28T12:53:00+00:00",
      textDescription: "Partly Cloudy",
      temperature: { unitCode: "wmoUnit:degC", value: 25 },
      dewpoint: { unitCode: "wmoUnit:degC", value: 20 },
      relativeHumidity: { unitCode: "wmoUnit:percent", value: 73 },
      windDirection: { unitCode: "wmoUnit:degree_(angle)", value: 370 },
      windSpeed: { unitCode: "wmoUnit:km_h", value: 16.09344 },
      windGust: { unitCode: "wmoUnit:kt", value: 20 },
      visibility: { unitCode: "wmoUnit:m", value: 16093.44 },
      barometricPressure: { unitCode: "wmoUnit:Pa", value: 101325 },
      seaLevelPressure: { unitCode: "wmoUnit:hPa", value: 1013.25 },
      precipitationLastHour: { unitCode: "wmoUnit:mm", value: 2.54 },
      precipitationLast3Hours: { unitCode: "unit:cm", value: 2.54 },
      precipitationLast6Hours: { unitCode: "unit:in", value: 0.5 },
    },
  }],
};

describe("NWS station observations parser", () => {
  test("converts official NWS quantity values to weather.gov-style US units", () => {
    const row = parseNwsStationObservations(payload, "katl").observations[0]!;
    expect(row).toMatchObject({
      stationId: "KATL",
      textDescription: "Partly Cloudy",
      temperatureF: 77,
      dewpointF: 68,
      relativeHumidity: 73,
      windDirectionDeg: 10,
      visibilityMi: 10,
      precipitationLastHourIn: 0.1,
      precipitationLast3HoursIn: 1,
      precipitationLast6HoursIn: 0.5,
    });
    expect(row.windSpeedMph).toBeCloseTo(10);
    expect(row.windGustMph).toBeCloseTo(23.01558896);
    expect(row.barometricPressureInHg).toBeCloseTo(29.9212598445);
    expect(row.seaLevelPressureInHg).toBeCloseTo(29.9212598445);
  });

  test("keeps missing quantities null and ignores malformed observation features", () => {
    const parsed = parseNwsStationObservations({
      features: [
        { properties: { timestamp: "not a date" } },
        { properties: { timestamp: "2026-08-28T12:53:00Z", temperature: { unitCode: "wmoUnit:degC", value: null } } },
      ],
    }, "KATL");
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]?.temperatureF).toBeNull();
    expect(parsed.observations[0]?.visibilityMi).toBeNull();
  });
});
