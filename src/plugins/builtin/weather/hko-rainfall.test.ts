import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  fetchHkoMonthlyRainfall,
  hkoRainfallToObservation,
  normalizeHkoMonthlyRainfallPayload,
  normalizeHkoYearMonth,
  resetHkoRainfallCache,
} from "./hko-rainfall";

describe("HKO year-month normalization", () => {
  test("pads single-digit months and rejects out-of-range months", () => {
    expect(normalizeHkoYearMonth("2026-8")).toBe("2026-08");
    expect(normalizeHkoYearMonth("2026-08")).toBe("2026-08");
    expect(normalizeHkoYearMonth("2026-13")).toBeNull();
    expect(normalizeHkoYearMonth("not-a-month")).toBeNull();
    expect(normalizeHkoYearMonth({ year: 2026, month: 9 })).toBe("2026-09");
    expect(normalizeHkoYearMonth({ year: 2026, month: 0 })).toBeNull();
  });
});

describe("HKO monthly rainfall normalize", () => {
  test("parses a flat official monthly report", () => {
    const report = normalizeHkoMonthlyRainfallPayload({
      source: "hko",
      stationId: "HKG",
      year: 2026,
      month: 8,
      rainfallMm: 412.3,
      normalMm: 391.4,
      departureMm: 20.9,
      status: "official",
    });
    expect(report).toMatchObject({
      stationId: "HKG",
      yearMonth: "2026-08",
      rainfallMm: 412.3,
      normalMm: 391.4,
      departureMm: 20.9,
      status: "official",
    });
  });

  test("accepts yearMonth string and alternate rainfall keys", () => {
    const report = normalizeHkoMonthlyRainfallPayload({
      station: "VHHH",
      yearMonth: "2026-07",
      totalRainfallMm: 350.1,
      normalRainfallMm: 376.2,
      departureRainfallMm: -26.1,
    });
    expect(report).toMatchObject({
      stationId: "HKG",
      yearMonth: "2026-07",
      rainfallMm: 350.1,
      normalMm: 376.2,
      departureMm: -26.1,
      status: "unknown",
    });
  });

  test("picks the requested month out of a results array", () => {
    const report = normalizeHkoMonthlyRainfallPayload({
      source: "hko",
      yearMonth: "2026-08",
      results: [
        { year: 2026, month: 7, rainfallMm: 120 },
        { year: 2026, month: 8, rainfallMm: 412.3, status: "official" },
      ],
    });
    expect(report?.rainfallMm).toBe(412.3);
    expect(report?.status).toBe("official");
  });

  test("maps rainfall onto the shared daily observation in inches", () => {
    const report = normalizeHkoMonthlyRainfallPayload({
      stationId: "HKG",
      yearMonth: "2026-08",
      rainfallMm: 25.4,
      status: "official",
    })!;
    const observation = hkoRainfallToObservation(report);
    expect(observation).toMatchObject({
      stationId: "HKG",
      date: "2026-08-01",
      precipitation: 1,
      status: "official",
      official: true,
    });
    expect(observation.maxTemp).toBeNull();
    expect(observation.minTemp).toBeNull();
  });

  test("returns null for a payload with no usable month", () => {
    expect(normalizeHkoMonthlyRainfallPayload({ source: "hko" })).toBeNull();
    expect(normalizeHkoMonthlyRainfallPayload(null)).toBeNull();
    expect(normalizeHkoMonthlyRainfallPayload("nope")).toBeNull();
  });

  test("tolerates missing rainfall without throwing", () => {
    const report = normalizeHkoMonthlyRainfallPayload({
      stationId: "HKG",
      yearMonth: "2026-08",
    });
    expect(report?.rainfallMm).toBeNull();
    expect(report?.normalMm).toBeNull();
  });
});

describe("HKO monthly rainfall fetch", () => {
  afterEach(() => {
    setHttpFetchTransport(null);
    resetHkoRainfallCache();
  });

  test("fetches and caches an official monthly print", async () => {
    setHttpFetchTransport(async (url) => {
      expect(url).toContain("year=2026");
      expect(url).toContain("month=8");
      return new Response(JSON.stringify({
        source: "hko",
        stationId: "HKG",
        year: 2026,
        month: 8,
        rainfallMm: 412.3,
        normalMm: 391.4,
        status: "official",
      }), { status: 200 });
    });
    const first = await fetchHkoMonthlyRainfall("2026-08", 1_000);
    expect(first).toMatchObject({ yearMonth: "2026-08", rainfallMm: 412.3, status: "official" });
    // Served from cache before the TTL expires.
    let calls = 0;
    setHttpFetchTransport(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const cached = await fetchHkoMonthlyRainfall("2026-08", 2_000);
    expect(cached).toEqual(first);
    expect(calls).toBe(0);
  });

  test("returns null and caches the miss when the request fails", async () => {
    setHttpFetchTransport(async () => new Response("server error", { status: 500 }));
    const report = await fetchHkoMonthlyRainfall("2026-09", 1_000);
    expect(report).toBeNull();
  });

  test("rejects a malformed year-month", async () => {
    expect(await fetchHkoMonthlyRainfall("2026-13", 1_000)).toBeNull();
    expect(await fetchHkoMonthlyRainfall("nope", 1_000)).toBeNull();
  });
});
