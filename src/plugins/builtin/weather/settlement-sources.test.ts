import { describe, expect, test } from "bun:test";
import type { NwsCliPrint } from "../../../sources/nws-cli/types";
import type { NwsDailyAggregate } from "../../../sources/nws-observations/types";
import type { WeatherHourlyObservation } from "./types";
import {
  cliPrintToSettlementRecord,
  dailyAggregateToSettlementRecord,
  hourlyObservationToSettlementRecord,
  loadNwsCliSettlement,
  loadNwsObservationsSettlement,
  loadSettlementRecord,
  settlementSourceLabel,
} from "./settlement-sources";

function cliPrint(overrides: Partial<NwsCliPrint> = {}): NwsCliPrint {
  return {
    provider: "nws-cli",
    seriesId: "KNYC",
    icao: "KNYC",
    cliProduct: "CLINYC",
    date: "2026-08-18",
    issuedAt: "2026-08-19T05:32:00Z",
    printKind: "final",
    highF: 87,
    lowF: 70,
    precipIn: 0.12,
    productId: "abc123",
    sourceUrl: "https://api.weather.gov/products/abc123",
    ...overrides,
  };
}

function dailyAggregate(overrides: Partial<NwsDailyAggregate> = {}): NwsDailyAggregate {
  return {
    provider: "nws-observations",
    stationId: "KNYC",
    icao: "KNYC",
    date: "2026-08-18",
    maxTempF: 86,
    minTempF: 68,
    precipIn: 0.1,
    sampleCount: 24,
    firstTimestamp: "2026-08-18T00:53:00Z",
    lastTimestamp: "2026-08-18T23:53:00Z",
    sourceUrl: "https://api.weather.gov/stations/KNYC/observations",
    fetchedAt: 1,
    ...overrides,
  };
}

function hourlyObs(overrides: Partial<WeatherHourlyObservation> = {}): WeatherHourlyObservation {
  return {
    stationId: "LAX",
    icao: "KLAX",
    date: "2026-08-19",
    hourLocal: 15,
    reportTimeUtc: "2026-08-19T22:00:00Z",
    tempF: 82,
    tempC: 27.8,
    status: "settled",
    ...overrides,
  };
}

describe("settlement source mapping", () => {
  test("cliPrintToSettlementRecord maps high/low/precip with CLI revision metadata", () => {
    const high = cliPrintToSettlementRecord(cliPrint(), "NYC", "high", 100);
    expect(high).toMatchObject({
      stationId: "NYC",
      icao: "KNYC",
      date: "2026-08-18",
      metric: "high",
      value: 87,
      high: 87,
      low: 70,
      precip: 0.12,
      hourLocal: null,
    });
    expect(high.meta).toMatchObject({
      source: "nws-cli",
      sourceName: "NWS Daily Climate Report (CLI)",
      revision: "abc123",
      fetchedAt: 100,
      sourceUrl: "https://api.weather.gov/products/abc123",
      official: true,
      status: "final",
    });

    const low = cliPrintToSettlementRecord(cliPrint(), "NYC", "low");
    expect(low.value).toBe(70);
    expect(low.meta.source).toBe("nws-cli");

    const precip = cliPrintToSettlementRecord(cliPrint(), "NYC", "precip");
    expect(precip.value).toBe(0.12);
  });

  test("cliPrintToSettlementRecord marks preliminary prints as non-official", () => {
    const record = cliPrintToSettlementRecord(cliPrint({ printKind: "preliminary" }), "NYC", "high");
    expect(record.meta.official).toBe(false);
    expect(record.meta.status).toBe("preliminary");
  });

  test("dailyAggregateToSettlementRecord maps observation aggregate with timestamp revision", () => {
    const high = dailyAggregateToSettlementRecord(dailyAggregate(), "NYC", "high");
    expect(high).toMatchObject({
      stationId: "NYC",
      icao: "KNYC",
      date: "2026-08-18",
      metric: "high",
      value: 86,
      high: 86,
      low: 68,
      precip: 0.1,
    });
    expect(high.meta).toMatchObject({
      source: "nws-observations",
      sourceName: "NOAA/NWS Station Observations",
      revision: "2026-08-18T23:53:00Z",
      fetchedAt: 1,
      sourceUrl: "https://api.weather.gov/stations/KNYC/observations",
      official: true,
      status: "24 observations",
    });

    const low = dailyAggregateToSettlementRecord(dailyAggregate(), "NYC", "low");
    expect(low.value).toBe(68);
  });

  test("dailyAggregateToSettlementRecord reports null status for zero-sample aggregate", () => {
    const record = dailyAggregateToSettlementRecord(dailyAggregate({ sampleCount: 0 }), "NYC", "high");
    expect(record.meta.official).toBe(false);
    expect(record.meta.status).toBeNull();
  });

  test("hourlyObservationToSettlementRecord maps TWC METAR with report-time revision", () => {
    const record = hourlyObservationToSettlementRecord(hourlyObs(), "LAX", "KLAX", "2026-08-19", 200);
    expect(record).toMatchObject({
      stationId: "LAX",
      icao: "KLAX",
      date: "2026-08-19",
      metric: "hourly",
      value: 82,
      high: 82,
      low: 82,
      precip: null,
      hourLocal: 15,
    });
    expect(record.meta).toMatchObject({
      source: "twc-kalshi",
      sourceName: "Kalshi Weather Company (TWC METAR)",
      revision: "2026-08-19T22:00:00Z",
      fetchedAt: 200,
      official: true,
      status: "settled",
    });
  });

  test("hourlyObservationToSettlementRecord marks non-settled observations as non-official", () => {
    const record = hourlyObservationToSettlementRecord(hourlyObs({ status: "live" }), "LAX", "KLAX", "2026-08-19");
    expect(record.meta.official).toBe(false);
    expect(record.meta.status).toBe("live");
  });
});

describe("settlement source routing", () => {
  test("settlementSourceLabel maps each source id to a display name", () => {
    expect(settlementSourceLabel("nws-cli")).toBe("NWS CLI");
    expect(settlementSourceLabel("nws-observations")).toBe("NWS Observations");
    expect(settlementSourceLabel("twc-kalshi")).toBe("TWC Kalshi");
  });

  test("loadNwsCliSettlement rejects hourly metric", async () => {
    await expect(loadNwsCliSettlement("NYC", "2026-08-18", "hourly")).rejects.toThrow();
  });

  test("loadNwsObservationsSettlement rejects hourly metric", async () => {
    await expect(loadNwsObservationsSettlement("NYC", "2026-08-18", "hourly")).rejects.toThrow();
  });

  test("loadSettlementRecord routes hourly to the TWC adapter which throws for unknown stations", async () => {
    await expect(loadSettlementRecord("ZZZ", "2026-08-18", "hourly")).rejects.toThrow();
  });
});
