import { describe, expect, test } from "bun:test";
import {
  isWeatherSettlementSource,
  parseCliProductFromText,
  parseKalshiWeatherEventStamp,
  parseKalshiWeatherSeriesTicker,
  parseWeatherMetric,
  resolveWeatherSettlement,
} from "./mapping";
import {
  normalizeInternationalClimatePayload,
  normalizeMetarPayload,
  normalizePrimaryClimatePayload,
  observationValue,
} from "./normalize";
import { canonicalWeatherStationId, cliProductForStation } from "./stations";
import { weatherRequestUrl } from "./client";

const PRIMARY_FIXTURE = {
  date: "2026-08-18",
  source: "live",
  results: [
    {
      station: {
        id: "klax",
        city: "Los Angeles",
        country: "United States",
        icao: "KLAX",
        timezone: "America/Los_Angeles",
        isDomestic: true,
        cliId: "LAX",
      },
      data: {
        location: "Los Angeles",
        stationId: "LAX",
        reportDate: "2026-08-18",
        maxTemp: 82,
        minTemp: 68,
        precipitation: 0,
        snowfall: null,
        isOfficial: true,
      },
      status: "official",
    },
    {
      station: {
        id: "kmdw",
        city: "Chicago (Midway)",
        icao: "KMDW",
        timezone: "America/Chicago",
        isDomestic: true,
        cliId: "MDW",
      },
      data: {
        stationId: "MDW",
        reportDate: "2026-08-18",
        maxTemp: 81,
        minTemp: 66,
        precipitation: 0.12,
        isOfficial: true,
      },
      status: "official",
    },
  ],
};

describe("weather station tokens", () => {
  test("normalizes CLI products, ICAO, and Kalshi city aliases", () => {
    expect(canonicalWeatherStationId("CLILAX")).toBe("LAX");
    expect(canonicalWeatherStationId("klax")).toBe("LAX");
    expect(canonicalWeatherStationId("NY")).toBe("NYC");
    expect(canonicalWeatherStationId("CHI")).toBe("MDW");
    expect(cliProductForStation("LAX")).toBe("CLILAX");
  });
});

describe("weather series metric parse", () => {
  test("accepts high/low/hourly aliases", () => {
    expect(parseWeatherMetric("tmax")).toBe("high");
    expect(parseWeatherMetric("min")).toBe("low");
    expect(parseWeatherMetric("temp")).toBe("hourly");
    expect(parseWeatherMetric("nope")).toBeNull();
  });
});

describe("Kalshi weather settlement mapping", () => {
  test("maps series tickers onto TWC climate ids and metrics", () => {
    expect(parseKalshiWeatherSeriesTicker("KXHIGHLAX-26AUG19")).toEqual({
      stationId: "LAX",
      metric: "high",
      seriesTicker: "KXHIGHLAX",
    });
    expect(parseKalshiWeatherSeriesTicker("KXHIGHNY")).toEqual({
      stationId: "NYC",
      metric: "high",
      seriesTicker: "KXHIGHNY",
    });
    expect(parseKalshiWeatherSeriesTicker("KXHIGHCHI")).toEqual({
      stationId: "MDW",
      metric: "high",
      seriesTicker: "KXHIGHCHI",
    });
    expect(parseKalshiWeatherSeriesTicker("KXLOWTLAX")).toEqual({
      stationId: "LAX",
      metric: "low",
      seriesTicker: "KXLOWTLAX",
    });
    expect(parseKalshiWeatherSeriesTicker("KXTEMPLAXH-26AUG1915")).toEqual({
      stationId: "LAX",
      metric: "hourly",
      seriesTicker: "KXTEMPLAXH",
    });
    expect(parseKalshiWeatherSeriesTicker("KXFED")).toBeNull();
  });

  test("parses event date and optional hour from the ticker suffix", () => {
    expect(parseKalshiWeatherEventStamp("KXHIGHLAX-26AUG19")).toEqual({
      date: "2026-08-19",
      hour: null,
    });
    expect(parseKalshiWeatherEventStamp("KXTEMPLAXH-26AUG1915")).toEqual({
      date: "2026-08-19",
      hour: 15,
    });
  });

  test("prefers the CLI product named in the rules over the series alias", () => {
    expect(parseCliProductFromText("max temp at Chicago (CLIMDW) for the calendar day")).toBe("MDW");
    const settlement = resolveWeatherSettlement({
      venue: "kalshi",
      seriesTicker: "KXHIGHCHI",
      eventTicker: "KXHIGHCHI-26AUG19",
      title: "Highest temperature in Chicago on Aug 19, 2026?",
      rulesPrimary:
        "If the maximum temperature recorded at Chicago (CLIMDW) for Aug 19, 2026, is less than 74° fahrenheit according to The Weather Company, then the market resolves to Yes.",
      resolutionSource: "The Weather Company",
      settlementUrl: "https://weather.com/kalshi",
    });
    expect(settlement).toMatchObject({
      stationId: "MDW",
      metric: "high",
      date: "2026-08-19",
      cliProduct: "CLIMDW",
    });
  });

  test("is visible for TWC climate markets and hidden for Fed/election sources", () => {
    expect(isWeatherSettlementSource({
      venue: "kalshi",
      seriesTicker: "KXHIGHLAX",
      resolutionSource: "The Weather Company",
    })).toBe(true);
    expect(isWeatherSettlementSource({
      venue: "kalshi",
      seriesTicker: "KXFED",
      category: "Economics",
      resolutionSource: "FOMC",
      title: "Will the Fed hike?",
    })).toBe(false);
    expect(resolveWeatherSettlement({
      venue: "kalshi",
      seriesTicker: "KXFED",
      eventTicker: "KXFED-26AUG",
      resolutionSource: "FOMC",
      title: "Will the Fed hike?",
    })).toBeNull();
  });
});

describe("TWC climate payload normalize", () => {
  test("extracts official daily highs and lows by climate id", () => {
    const snapshot = normalizePrimaryClimatePayload(PRIMARY_FIXTURE);
    expect(snapshot.date).toBe("2026-08-18");
    const lax = snapshot.observations.find((row) => row.stationId === "LAX");
    expect(lax).toMatchObject({
      maxTemp: 82,
      minTemp: 68,
      precipitation: 0,
      status: "official",
      official: true,
    });
    expect(observationValue(lax!, "high")).toBe(82);
    expect(observationValue(lax!, "low")).toBe(68);
    const mdw = snapshot.observations.find((row) => row.stationId === "MDW");
    expect(mdw?.precipitation).toBe(0.12);
  });

  test("normalizes international rows that flatten station fields", () => {
    const snapshot = normalizeInternationalClimatePayload({
      date: "2026-08-18",
      results: [{
        id: "egll",
        city: "London",
        country: "United Kingdom",
        icao: "EGLL",
        timezone: "Europe/London",
        date: "2026-08-18",
        maxTemp: 24,
        minTemp: 14,
        status: "official",
      }],
    });
    expect(snapshot.observations[0]).toMatchObject({
      stationId: "LHR",
      maxTemp: 24,
      minTemp: 14,
      status: "official",
    });
  });

  test("normalizes METAR hourly temps onto climate ids", () => {
    const snapshot = normalizeMetarPayload({
      source: "live",
      stations: [{
        icaoId: "KLAX",
        stationName: "Los Angeles",
        timezone: "America/Los_Angeles",
        observations: [{
          reportTimeUTC: "2026-08-19T18:00:00.000Z",
          tempF: 82,
          tempC: 27.8,
          localDate: "2026-08-19",
          localHour: 11,
          status: "settled",
        }],
      }],
    });
    expect(snapshot.observations[0]).toMatchObject({
      stationId: "LAX",
      tempF: 82,
      date: "2026-08-19",
      hourLocal: 11,
    });
  });
});

describe("hosted weather request URL", () => {
  test("uses weather.com directly outside the hosted web client", () => {
    expect(weatherRequestUrl("/kalshi/api/climate/primary?date=2026-08-18")).toBe(
      "https://weather.com/kalshi/api/climate/primary?date=2026-08-18",
    );
  });
});

