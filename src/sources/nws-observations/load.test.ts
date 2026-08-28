import { describe, expect, test } from "bun:test";
import { loadNwsDailyAggregate, loadNwsObservations } from "./load";

const OBSERVATIONS_BODY = {
  features: [
    {
      id: "https://api.weather.gov/stations/KNYC/observations/2026-08-19T18:00:00+00:00",
      properties: {
        timestamp: "2026-08-19T18:00:00Z",
        temperature: { value: 30, unitCode: "wmoUnit:degC" },
        precipitationLastHour: { value: 0, unitCode: "wmoUnit:mm" },
        qualityControl: { qualityControl: "passed" },
      },
    },
    {
      id: "https://api.weather.gov/stations/KNYC/observations/2026-08-19T12:00:00+00:00",
      properties: {
        timestamp: "2026-08-19T12:00:00Z",
        temperature: { value: 20, unitCode: "wmoUnit:degC" },
        precipitationLastHour: { value: 2.54, unitCode: "wmoUnit:mm" },
        qualityControl: { qualityControl: "passed" },
      },
    },
    {
      id: "https://api.weather.gov/stations/KNYC/observations/2026-08-20T00:00:00+00:00",
      properties: {
        timestamp: "2026-08-20T00:00:00Z",
        temperature: { value: 25, unitCode: "wmoUnit:degC" },
        qualityControl: { qualityControl: "passed" },
      },
    },
  ],
};

describe("NWS observations load", () => {
  test("loads raw observations from the NWS station endpoint", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/stations/KNYC/observations")) {
        return Response.json(OBSERVATIONS_BODY);
      }
      return new Response("not found", { status: 404 });
    };
    const set = await loadNwsObservations({ icao: "KNYC", fetchImpl });
    expect(set.icao).toBe("KNYC");
    expect(set.observations).toHaveLength(3);
    expect(set.observations[0]?.tempF).toBe(86);
  });

  test("aggregates observations into a daily max/min for the requested date", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/stations/KNYC/observations")) {
        return Response.json(OBSERVATIONS_BODY);
      }
      return new Response("not found", { status: 404 });
    };
    const daily = await loadNwsDailyAggregate({ icao: "KNYC", date: "2026-08-19", fetchImpl });
    expect(daily).toMatchObject({
      stationId: "KNYC",
      icao: "KNYC",
      date: "2026-08-19",
      maxTempF: 86,
      minTempF: 68,
      precipIn: 0.1,
      sampleCount: 2,
    });
  });

  test("returns null when no observations match the date", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/stations/KNYC/observations")) {
        return Response.json(OBSERVATIONS_BODY);
      }
      return new Response("not found", { status: 404 });
    };
    const daily = await loadNwsDailyAggregate({ icao: "KNYC", date: "2025-01-01", fetchImpl });
    expect(daily).toBeNull();
  });

  test("throws on a non-200 response", async () => {
    const fetchImpl: typeof fetch = async () => new Response("error", { status: 500 });
    await expect(loadNwsObservations({ icao: "KNYC", fetchImpl })).rejects.toThrow();
  });
});
