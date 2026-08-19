import { describe, expect, test } from "bun:test";
import { EMPTY_WEATHER_ARCHIVE, mergeWeatherArchive } from "./archive";
import { impliedBackfillJobs, officialArchiveObservations } from "./backfill";

describe("weather archive backfill", () => {
  test("maps official TWC prints to settlements and never to Y.FC", () => {
    const observations = officialArchiveObservations([
      { stationId: "LAX", date: "2026-08-18", maxTemp: 82, minTemp: 68, precipitation: 0, snowfall: null, status: "official", official: true },
      { stationId: "LAX", date: "2026-08-19", maxTemp: 79, minTemp: 66, precipitation: 0, snowfall: null, status: "pending", official: false },
    ]);
    expect(observations).toEqual([
      { stationId: "LAX", date: "2026-08-18", high: 82, official: true },
    ]);
    const archive = mergeWeatherArchive(EMPTY_WEATHER_ARCHIVE, {
      today: "2026-08-19",
      observations,
    });
    expect(archive.records[0]).toMatchObject({
      forecastHigh: null,
      impliedHigh: null,
      settlementHigh: 82,
    });
  });

  test("queues missing implied days newest-first and skips days already frozen", () => {
    const seeded = mergeWeatherArchive(EMPTY_WEATHER_ARCHIVE, {
      today: "2026-08-19",
      implied: [{ stationId: "LAX", date: "2026-08-18", impliedHigh: 79.7, eventOpen: true }],
    });
    const jobs = impliedBackfillJobs(seeded, "2026-08-19", [
      { id: "LAX", city: "Los Angeles", country: "United States", icao: "KLAX", timezone: "America/Los_Angeles", scope: "domestic", aliases: ["LAX"] },
    ], 3);
    expect(jobs.map((job) => `${job.stationId}:${job.date}`)).toEqual(["LAX:2026-08-17"]);
  });
});
