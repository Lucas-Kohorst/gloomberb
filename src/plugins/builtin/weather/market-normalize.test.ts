import { describe, expect, test } from "bun:test";
import {
  detectWeatherSource,
  isWeatherMarket,
  normalizeKalshiWeatherMarket,
  normalizePolymarketWeatherMarket,
  normalizeWeatherMarket,
  type WeatherMarketInput,
} from "./market-normalize";
import type { KalshiMarketRecord } from "../../prediction-markets/services/kalshi/types";
import type {
  PolymarketEventRecord,
  PolymarketMarketRecord,
} from "../../prediction-markets/services/polymarket/types";

function kalshiRecord(overrides: Partial<KalshiMarketRecord> & { ticker: string; title: string }): KalshiMarketRecord {
  return {
    status: "open",
    market_type: "binary",
    ...overrides,
  } as KalshiMarketRecord;
}

function polymarketRecord(
  overrides: Partial<PolymarketMarketRecord> & { question: string },
  event?: Partial<PolymarketEventRecord> & { id: string },
): { record: PolymarketMarketRecord; event: PolymarketEventRecord | undefined } {
  const record: PolymarketMarketRecord = {
    outcomes: ["Yes", "No"],
    ...overrides,
  } as PolymarketMarketRecord;
  const evt = event
    ? ({ ...event } as PolymarketEventRecord)
    : undefined;
  return { record, event: evt };
}

describe("weather source detection", () => {
  test("detects TWC, NWS, NHC, SPC, and Drought Monitor by name", () => {
    expect(detectWeatherSource("according to The Weather Company")).toBe("The Weather Company");
    expect(detectWeatherSource("reported by the National Weather Service")).toBe("NWS");
    expect(detectWeatherSource("per the NHC best track")).toBe("NHC");
    expect(detectWeatherSource("Storm Prediction Center tornado reports")).toBe("SPC");
    expect(detectWeatherSource("U.S. Drought Monitor")).toBe("U.S. Drought Monitor");
    expect(detectWeatherSource("NOAA climate data")).toBe("NOAA");
    expect(detectWeatherSource("some random source")).toBeNull();
  });
});

describe("isWeatherMarket", () => {
  test("recognizes Kalshi weather series tickers and rejects Fed markets", () => {
    expect(isWeatherMarket({
      venue: "kalshi",
      marketId: "KXHIGHLAX-26AUG19-B82.5",
      seriesTicker: "KXHIGHLAX",
      eventTicker: "KXHIGHLAX-26AUG19",
      title: "Will the high in Los Angeles be above 82.5°F?",
    })).toBe(true);

    expect(isWeatherMarket({
      venue: "kalshi",
      marketId: "KXFED-26SEP-T4.25",
      seriesTicker: "KXFED",
      title: "Will the Fed cut rates?",
      rulesPrimary: "Resolves to the FOMC statement.",
    })).toBe(false);
  });

  test("recognizes Polymarket weather markets by title/rules text", () => {
    expect(isWeatherMarket({
      venue: "polymarket",
      marketId: "rain-nyc-aug",
      title: "Will it rain in New York on August 19?",
      rulesPrimary: "Resolves to NOAA daily precipitation observations.",
    })).toBe(true);
  });
});

describe("normalizeWeatherMarket — Kalshi daily high", () => {
  const input: WeatherMarketInput = {
    venue: "kalshi",
    marketId: "KXHIGHLAX-26AUG19-B82.5",
    seriesTicker: "KXHIGHLAX",
    eventTicker: "KXHIGHLAX-26AUG19",
    title: "Will the high temperature in Los Angeles be above 82.5°F on Aug 19, 2026?",
    rulesPrimary:
      "This market resolves to The Weather Company Climatological Report (CLILAX) daily maximum temperature. If the maximum temperature recorded at Los Angeles (CLILAX) for Aug 19, 2026, is greater than 82.5° fahrenheit according to The Weather Company, then the market resolves to Yes.",
    resolutionSource: "The Weather Company",
    strikeType: "greater",
    floorStrike: 82.5,
  };

  test("parses family, station, date, timezone, units, bracket", () => {
    const spec = normalizeWeatherMarket(input);
    expect(spec.recognized).toBe(true);
    expect(spec.family).toBe("daily-high");
    expect(spec.stationId).toBe("LAX");
    expect(spec.dateWindow).toEqual({ start: "2026-08-19", hour: null, label: null });
    expect(spec.timezone).toBe("America/Los_Angeles");
    expect(spec.unit).toBe("f");
    expect(spec.precision).toBe(1);
    expect(spec.bracket).toBe("greater-than");
    expect(spec.floor).toBe(82.5);
    expect(spec.cap).toBeNull();
  });

  test("parses revision policy, fallback source, settlement url, source explicit", () => {
    const spec = normalizeWeatherMarket(input);
    expect(spec.revisionPolicy).toBe("official-final");
    expect(spec.fallbackSource).toBe("NWS");
    expect(spec.source).toBe("The Weather Company");
    expect(spec.sourceExplicit).toBe(true);
    expect(spec.settlementUrl).toBe("https://weather.com/kalshi");
  });

  test("between bracket reads both floor and cap", () => {
    const spec = normalizeWeatherMarket({
      ...input,
      marketId: "KXHIGHLAX-26AUG19-R80-B85",
      strikeType: "between",
      floorStrike: 80,
      capStrike: 85,
      title: "Will the high in Los Angeles be between 80 and 85°F?",
    });
    expect(spec.bracket).toBe("between");
    expect(spec.floor).toBe(80);
    expect(spec.cap).toBe(85);
  });

  test("less-than bracket reads only cap", () => {
    const spec = normalizeWeatherMarket({
      ...input,
      strikeType: "less",
      floorStrike: null,
      capStrike: 75,
      title: "Will the high in Los Angeles be below 75°F?",
    });
    expect(spec.bracket).toBe("less-than");
    expect(spec.floor).toBeNull();
    expect(spec.cap).toBe(75);
  });
});

describe("normalizeWeatherMarket — Kalshi daily low", () => {
  test("classifies KXLOWT series as daily-low with low bracket", () => {
    const spec = normalizeWeatherMarket({
      venue: "kalshi",
      marketId: "KXLOWTLAX-26AUG19-B60",
      seriesTicker: "KXLOWTLAX",
      eventTicker: "KXLOWTLAX-26AUG19",
      title: "Will the low temperature in Los Angeles be below 60°F on Aug 19, 2026?",
      rulesPrimary: "Resolves to The Weather Company (CLILAX) daily minimum temperature.",
      resolutionSource: "The Weather Company",
      strikeType: "less",
      capStrike: 60,
    });
    expect(spec.family).toBe("daily-low");
    expect(spec.stationId).toBe("LAX");
    expect(spec.bracket).toBe("less-than");
    expect(spec.cap).toBe(60);
    expect(spec.unit).toBe("f");
  });
});

describe("normalizeWeatherMarket — Kalshi hourly temp", () => {
  test("classifies KXTEMP..H series as hourly-temp with hour and fixed-cutoff", () => {
    const spec = normalizeWeatherMarket({
      venue: "kalshi",
      marketId: "KXTEMPLAXH-26AUG1915-B80",
      seriesTicker: "KXTEMPLAXH",
      eventTicker: "KXTEMPLAXH-26AUG1915",
      title: "Will the temperature in Los Angeles at 3pm on Aug 19, 2026 be above 80°F?",
      rulesPrimary: "Resolves to the METAR observation at KLAX for 15:00 local.",
      strikeType: "greater",
      floorStrike: 80,
    });
    expect(spec.family).toBe("hourly-temp");
    expect(spec.dateWindow).toEqual({ start: "2026-08-19", hour: 15, label: null });
    expect(spec.revisionPolicy).toBe("fixed-cutoff");
    expect(spec.unit).toBe("f");
  });
});

describe("normalizeWeatherMarket — Kalshi monthly precip", () => {
  test("classifies KXRAIN series as monthly-precip with month window and inches", () => {
    const spec = normalizeWeatherMarket({
      venue: "kalshi",
      marketId: "KXRAINNYC-26AUG-B2.5",
      seriesTicker: "KXRAINNYC",
      eventTicker: "KXRAINNYC-26AUG",
      title: "Will total precipitation in New York City exceed 2.5 inches in August 2026?",
      rulesPrimary:
        "Resolves to The Weather Weather Company (CLINYC) monthly total precipitation for August 2026.",
      resolutionSource: "The Weather Company",
      strikeType: "greater",
      floorStrike: 2.5,
    });
    expect(spec.family).toBe("monthly-precip");
    expect(spec.stationId).toBe("NYC");
    expect(spec.dateWindow).toEqual({ start: "2026-08", end: "2026-08", hour: null, label: "August 2026" });
    expect(spec.unit).toBe("in");
    expect(spec.precision).toBe(2);
    expect(spec.revisionPolicy).toBe("monthly-total");
    expect(spec.bracket).toBe("greater-than");
    expect(spec.floor).toBe(2.5);
  });
});

describe("normalizeWeatherMarket — monthly snowfall (rules-only)", () => {
  test("detects snowfall from title/rules when no series ticker matches", () => {
    const spec = normalizeWeatherMarket({
      venue: "kalshi",
      marketId: "KXSNOWBOS-26JAN-B30",
      seriesTicker: "KXSNOWBOS",
      title: "Will total snowfall in Boston exceed 30 inches in January 2026?",
      rulesPrimary:
        "Resolves to The Weather Company (CLIBOS) monthly total snowfall for January 2026.",
      resolutionSource: "The Weather Company",
      strikeType: "greater",
      floorStrike: 30,
    });
    expect(spec.recognized).toBe(true);
    expect(spec.family).toBe("monthly-snowfall");
    expect(spec.stationId).toBe("BOS");
    expect(spec.dateWindow?.start).toBe("2026-01");
    expect(spec.unit).toBe("in");
    expect(spec.revisionPolicy).toBe("monthly-total");
  });

  test("detects centimeters when rules mention cm", () => {
    const spec = normalizeWeatherMarket({
      venue: "polymarket",
      marketId: "snow-yyz-jan",
      title: "Will total snowfall in Toronto exceed 50 cm in January 2026?",
      rulesPrimary:
        "Resolves to Environment Canada monthly total snowfall for Toronto in January 2026, measured in centimeters.",
      resolutionSource: "Environment Canada",
      outcomes: ["Yes", "No"],
    });
    expect(spec.family).toBe("monthly-snowfall");
    expect(spec.unit).toBe("cm");
  });
});

describe("normalizeWeatherMarket — where will it rain", () => {
  test("classifies as where-rain with binary outcomes and categorical bracket", () => {
    const spec = normalizeWeatherMarket({
      venue: "polymarket",
      marketId: "where-rain-aug-19",
      title: "Where will it rain the most on August 19, 2026?",
      rulesPrimary:
        "Resolves to the NOAA multi-sensor precipitation estimate. The city with the highest rainfall total wins.",
      resolutionSource: "NOAA",
      outcomes: ["New York", "Miami", "Houston", "Chicago"],
    });
    expect(spec.family).toBe("where-rain");
    expect(spec.bracket).toBe("categorical");
    expect(spec.unit).toBe("binary");
    expect(spec.stationId).toBeNull();
    expect(spec.source).toBe("NOAA");
    expect(spec.sourceExplicit).toBe(true);
  });
});

describe("normalizeWeatherMarket — hurricane (explicit source)", () => {
  test("classifies hurricane season count market when NHC is named", () => {
    const spec = normalizeWeatherMarket({
      venue: "polymarket",
      marketId: "hurricane-season-2026-count",
      title: "Will there be more than 12 named storms in the 2026 Atlantic hurricane season?",
      rulesPrimary:
        "Resolves according to the National Hurricane Center (NHC) best track data for the 2026 Atlantic hurricane season.",
      resolutionSource: "NHC",
      outcomes: ["Yes", "No"],
    });
    expect(spec.family).toBe("hurricane");
    expect(spec.source).toBe("NHC");
    expect(spec.sourceExplicit).toBe(true);
    expect(spec.bracket).toBe("greater-than");
    expect(spec.unit).toBe("count");
    expect(spec.revisionPolicy).toBe("season-end");
    expect(spec.dateWindow?.start).toBe("2026");
  });

  test("classifies hurricane category market as categorical unit", () => {
    const spec = normalizeWeatherMarket({
      venue: "polymarket",
      marketId: "hurricane-cat5-2026",
      title: "Will a Category 5 hurricane make landfall in the US in 2026?",
      rulesPrimary:
        "Resolves to the National Hurricane Center Saffir-Simpson category ratings for the 2026 Atlantic hurricane season.",
      resolutionSource: "NHC",
      outcomes: ["Yes", "No"],
    });
    expect(spec.family).toBe("hurricane");
    expect(spec.unit).toBe("category");
    expect(spec.bracket).toBe("categorical");
  });

  test("does not classify hurricane when source is not explicit", () => {
    const spec = normalizeWeatherMarket({
      venue: "polymarket",
      marketId: "hurricane-vague",
      title: "Will there be a big hurricane this year?",
      rulesPrimary: "Resolves to news reports.",
      outcomes: ["Yes", "No"],
    });
    // "hurricane" keyword present but no explicit source -> not classified as hurricane.
    // It may still be recognized as a weather market but family should not be hurricane.
    expect(spec.family).not.toBe("hurricane");
  });
});

describe("normalizeWeatherMarket — tornado (explicit source)", () => {
  test("classifies tornado count market when SPC is named", () => {
    const spec = normalizeWeatherMarket({
      venue: "kalshi",
      marketId: "KXTORN-26MAY-B500",
      seriesTicker: "KXTORN",
      title: "Will there be more than 500 tornadoes in May 2026?",
      rulesPrimary:
        "Resolves to the NOAA Storm Prediction Center (SPC) tornado count for May 2026.",
      resolutionSource: "SPC",
      strikeType: "greater",
      floorStrike: 500,
    });
    expect(spec.family).toBe("tornado");
    expect(spec.source).toBe("SPC");
    expect(spec.unit).toBe("count");
    expect(spec.bracket).toBe("greater-than");
    expect(spec.floor).toBe(500);
    expect(spec.revisionPolicy).toBe("season-end");
  });

  test("classifies EF-category tornado market as category unit", () => {
    const spec = normalizeWeatherMarket({
      venue: "polymarket",
      marketId: "tornado-ef5-2026",
      title: "Will an EF5 tornado occur in 2026?",
      rulesPrimary:
        "Resolves to the NOAA Storm Prediction Center enhanced Fujita (EF) scale ratings.",
      resolutionSource: "SPC",
      outcomes: ["Yes", "No"],
    });
    expect(spec.family).toBe("tornado");
    expect(spec.unit).toBe("category");
  });
});

describe("normalizeWeatherMarket — drought (explicit source)", () => {
  test("classifies drought market when U.S. Drought Monitor is named", () => {
    const spec = normalizeWeatherMarket({
      venue: "polymarket",
      marketId: "drought-ca-2026-08",
      title: "Will California be in extreme drought by August 2026?",
      rulesPrimary:
        "Resolves to the U.S. Drought Monitor drought intensity classification for California in August 2026.",
      resolutionSource: "U.S. Drought Monitor",
      outcomes: ["Yes", "No"],
    });
    expect(spec.family).toBe("drought");
    expect(spec.source).toBe("US Drought Monitor");
    expect(spec.unit).toBe("category");
    expect(spec.dateWindow?.start).toBe("2026-08");
  });

  test("does not classify drought when source is not explicit", () => {
    const spec = normalizeWeatherMarket({
      venue: "polymarket",
      marketId: "drought-vague",
      title: "Will there be a drought somewhere this year?",
      rulesPrimary: "Resolves to general reporting.",
      outcomes: ["Yes", "No"],
    });
    expect(spec.family).not.toBe("drought");
  });
});

describe("normalizeWeatherMarket — non-weather rejection", () => {
  test("returns recognized false for a Fed market", () => {
    const spec = normalizeWeatherMarket({
      venue: "kalshi",
      marketId: "KXFED-26SEP-T4.25",
      seriesTicker: "KXFED",
      title: "Will the Fed cut rates at the September FOMC meeting?",
      rulesPrimary: "Resolves to the FOMC statement.",
    });
    expect(spec.recognized).toBe(false);
    expect(spec.stationId).toBeNull();
    expect(spec.dateWindow).toBeNull();
  });
});

describe("normalizeKalshiWeatherMarket adapter", () => {
  test("parses a full Kalshi high record with event metadata", () => {
    const spec = normalizeKalshiWeatherMarket(
      kalshiRecord({
        ticker: "KXHIGHCHI-26AUG19-B82.5",
        title: "Highest temperature in Chicago on Aug 19, 2026?",
        event_ticker: "KXHIGHCHI-26AUG19",
        yes_sub_title: "Above 82.5°",
        no_sub_title: "Below or equal 82.5°",
        rules_primary:
          "If the maximum temperature recorded at Chicago (CLIMDW) for Aug 19, 2026, is greater than 82.5° fahrenheit according to The Weather Company, then the market resolves to Yes.",
        strike_type: "greater",
        floor_strike: 82.5,
        close_time: "2026-08-19T23:59:00Z",
      }),
      { title: "Highest temperature in Chicago on Aug 19, 2026?", category: "Climate and Weather", series_ticker: "KXHIGHCHI" },
    );
    expect(spec.recognized).toBe(true);
    expect(spec.family).toBe("daily-high");
    expect(spec.stationId).toBe("MDW");
    expect(spec.dateWindow).toEqual({ start: "2026-08-19", hour: null, label: null });
    expect(spec.timezone).toBe("America/Chicago");
    expect(spec.bracket).toBe("greater-than");
    expect(spec.floor).toBe(82.5);
    expect(spec.source).toBe("The Weather Company");
    expect(spec.fallbackSource).toBe("NWS");
    expect(spec.settlementUrl).toBe("https://weather.com/kalshi");
  });
});

describe("normalizePolymarketWeatherMarket adapter", () => {
  test("parses a Polymarket daily-high market with NWS source", () => {
    const { record, event } = polymarketRecord(
      {
        id: "poly-high-nyc",
        question: "Will the high temperature in New York City exceed 90°F on August 19, 2026?",
        slug: "high-nyc-aug-19",
        description:
          "Resolves to the National Weather Service daily maximum temperature for Central Park (KNYC) on August 19, 2026.",
        outcomes: ["Yes", "No"],
        endDate: "2026-08-19T23:59:00Z",
      },
      { id: "evt-high-nyc", title: "NYC high temperature Aug 19", resolutionSource: "NWS" },
    );
    const spec = normalizePolymarketWeatherMarket(record, event);
    expect(spec.recognized).toBe(true);
    expect(spec.family).toBe("daily-high");
    expect(spec.source).toBe("NWS");
    expect(spec.sourceExplicit).toBe(true);
    expect(spec.dateWindow?.start).toBe("2026-08-19");
    expect(spec.unit).toBe("f");
    expect(spec.bracket).toBe("greater-than");
    expect(spec.settlementUrl).toBe("https://www.weather.gov");
  });

  test("parses a Polymarket monthly precip market in millimeters", () => {
    const { record, event } = polymarketRecord(
      {
        id: "poly-precip-london",
        question: "Will total precipitation in London exceed 60 mm in September 2026?",
        slug: "precip-london-sep",
        description:
          "Resolves to the Met Office monthly total precipitation for London in September 2026, measured in millimeters.",
        outcomes: ["Yes", "No"],
      },
      { id: "evt-precip-london", title: "London precipitation September 2026" },
    );
    const spec = normalizePolymarketWeatherMarket(record, event);
    expect(spec.family).toBe("monthly-precip");
    expect(spec.unit).toBe("mm");
    expect(spec.dateWindow?.start).toBe("2026-09");
    expect(spec.revisionPolicy).toBe("monthly-total");
  });
});
