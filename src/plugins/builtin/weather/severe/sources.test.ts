import { describe, expect, test } from "bun:test";
import {
  SEVERE_WEATHER_SOURCE_REGISTRY,
  getSevereWeatherAdapter,
  resolveSevereWeatherSource,
  NHC_ADAPTER,
  SPC_ADAPTER,
  DROUGHT_ADAPTER,
  NIFC_ADAPTER,
} from "./sources";
import type { SevereWeatherMarketHints } from "./types";

function hints(
  overrides: Partial<SevereWeatherMarketHints>,
): SevereWeatherMarketHints {
  return {
    venue: "kalshi",
    ...overrides,
  };
}

describe("severe weather source registry", () => {
  test("has four adapters in order: hurricane, tornado, drought, wildfire", () => {
    expect(SEVERE_WEATHER_SOURCE_REGISTRY.map((a) => a.kind)).toEqual([
      "hurricane",
      "tornado",
      "drought",
      "wildfire",
    ]);
  });

  test("getSevereWeatherAdapter returns the adapter for a known kind", () => {
    expect(getSevereWeatherAdapter("hurricane")).toBe(NHC_ADAPTER);
    expect(getSevereWeatherAdapter("tornado")).toBe(SPC_ADAPTER);
    expect(getSevereWeatherAdapter("drought")).toBe(DROUGHT_ADAPTER);
    expect(getSevereWeatherAdapter("wildfire")).toBe(NIFC_ADAPTER);
  });

  test("getSevereWeatherAdapter returns null for other", () => {
    expect(getSevereWeatherAdapter("other")).toBeNull();
  });
});

describe("resolveSevereWeatherSource — supported markets", () => {
  test("resolves a hurricane market with NHC in the rules to supported", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "kalshi",
      marketId: "KXHURR-26-landfall",
      title: "Will a Category 5 hurricane make landfall in the US in 2026?",
      rulesPrimary:
        "This market resolves per the National Hurricane Center (NHC) best track data. A landfall is counted when the NHC public advisory records the center of the cyclone crossing the coast.",
      resolutionSource: "National Hurricane Center",
    }));
    expect(result.status).toBe("supported");
    expect(result.kind).toBe("hurricane");
    expect(result.source).toBe("NHC");
    expect(result.sourceUrl).toBe("https://www.nhc.noaa.gov/");
    expect(result.dataUrl).toBe("https://www.nhc.noaa.gov/CurrentStorms.json");
    expect(result.reason).toMatch(/NHC/i);
  });

  test("resolves a hurricane market with NOAA in the rules to supported", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "polymarket",
      marketId: "hurricane-2026",
      title: "Will a major hurricane strike Florida in 2026?",
      rulesPrimary:
        "Resolves according to NOAA tropical cyclone advisories and the HURDAT2 best track database.",
    }));
    expect(result.status).toBe("supported");
    expect(result.source).toBe("NHC");
  });

  test("resolves a tornado market with SPC in the rules to supported", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "kalshi",
      marketId: "KXTORN-26-count",
      title: "Will there be more than 1,000 tornadoes in the US in 2026?",
      rulesPrimary:
        "Resolves per the NOAA Storm Prediction Center (SPC) storm reports. The SPC tornado count is the official count published at spc.noaa.gov.",
      resolutionSource: "Storm Prediction Center",
    }));
    expect(result.status).toBe("supported");
    expect(result.kind).toBe("tornado");
    expect(result.source).toBe("SPC");
    expect(result.sourceUrl).toBe("https://www.spc.noaa.gov/");
    expect(result.reason).toMatch(/SPC/i);
  });

  test("resolves a drought market with US Drought Monitor in the rules to supported", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "kalshi",
      marketId: "KXDRGT-26-pct",
      title: "Will more than 40% of the US be in drought by December 2026?",
      rulesPrimary:
        "Resolves per the US Drought Monitor (droughtmonitor.unl.edu) weekly map published by the NDMC, USDA, and NOAA.",
      resolutionSource: "US Drought Monitor",
    }));
    expect(result.status).toBe("supported");
    expect(result.kind).toBe("drought");
    expect(result.source).toBe("US Drought Monitor");
    expect(result.sourceUrl).toBe("https://droughtmonitor.unl.edu/");
    expect(result.reason).toMatch(/Drought Monitor/i);
  });

  test("resolves a wildfire market with NIFC in the rules to supported", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "kalshi",
      marketId: "KXFIRE-26-acres",
      title: "Will more than 8 million acres burn in US wildfires in 2026?",
      rulesPrimary:
        "Resolves per the National Interagency Fire Center (NIFC) national fire situation reports.",
      resolutionSource: "NIFC",
    }));
    expect(result.status).toBe("supported");
    expect(result.kind).toBe("wildfire");
    expect(result.source).toBe("NIFC");
    expect(result.sourceUrl).toBe("https://www.nifc.gov/");
    expect(result.reason).toMatch(/NIFC/i);
  });
});

describe("resolveSevereWeatherSource — manual markets (severe weather, no public source)", () => {
  test("returns manual for a hurricane market with no source named", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "polymarket",
      marketId: "hurricane-landfall",
      title: "Will a Category 5 hurricane make landfall in the US in 2026?",
      rulesPrimary: "Resolves Yes if a Category 5 hurricane makes landfall.",
    }));
    expect(result.status).toBe("manual");
    expect(result.kind).toBe("hurricane");
    expect(result.source).toBeNull();
    expect(result.sourceUrl).toBeNull();
    expect(result.dataUrl).toBeNull();
    expect(result.description).toMatch(/manually/i);
    expect(result.reason).toMatch(/No public source/i);
  });

  test("returns manual for a hurricane market with a private source", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "polymarket",
      marketId: "hurricane-accuweather",
      title: "Will a major hurricane strike the Gulf Coast in 2026?",
      rulesPrimary:
        "Resolves per AccuWeather's hurricane landfall tracking system.",
      resolutionSource: "AccuWeather",
    }));
    expect(result.status).toBe("manual");
    expect(result.kind).toBe("hurricane");
    expect(result.source).toBeNull();
  });

  test("returns manual for a tornado market with no source named", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "polymarket",
      marketId: "tornado-count",
      title: "Will there be more than 1,200 tornadoes in 2026?",
      rulesPrimary: "Resolves Yes if the total tornado count exceeds 1,200.",
    }));
    expect(result.status).toBe("manual");
    expect(result.kind).toBe("tornado");
    expect(result.source).toBeNull();
  });

  test("returns manual for a drought market with no source named", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "polymarket",
      marketId: "drought-pct",
      title: "Will 40% of the US be in drought by December 2026?",
      rulesPrimary: "Resolves Yes if 40% of the US is in drought.",
    }));
    expect(result.status).toBe("manual");
    expect(result.kind).toBe("drought");
    expect(result.source).toBeNull();
  });

  test("returns manual for a wildfire market with no source named", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "polymarket",
      marketId: "wildfire-acres",
      title: "Will more than 8 million acres burn in wildfires in 2026?",
      rulesPrimary: "Resolves Yes if total acreage burned exceeds 8 million.",
    }));
    expect(result.status).toBe("manual");
    expect(result.kind).toBe("wildfire");
    expect(result.source).toBeNull();
  });
});

describe("resolveSevereWeatherSource — unrelated markets", () => {
  test("returns unrelated for a daily temperature market", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "kalshi",
      marketId: "KXHIGHLAX-26AUG19-B82.5",
      title: "Will the high temperature in Los Angeles be above 82.5°F on Aug 19?",
      rulesPrimary:
        "Resolves to The Weather Company Climatological Report (CLILAX) daily maximum temperature.",
      category: "Climate and Weather",
    }));
    expect(result.status).toBe("unrelated");
    expect(result.kind).toBe("other");
    expect(result.source).toBeNull();
  });

  test("returns unrelated for a CPI market", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "kalshi",
      marketId: "KXCPI-26AUG",
      title: "Will CPI increase by more than 0.3% in August 2026?",
      rulesPrimary: "Resolves per BLS CPI-U.",
    }));
    expect(result.status).toBe("unrelated");
  });

  test("returns unrelated for an election market", () => {
    const result = resolveSevereWeatherSource(hints({
      venue: "polymarket",
      marketId: "pres-2026",
      title: "Will the incumbent win the 2026 gubernatorial election?",
      category: "Politics",
    }));
    expect(result.status).toBe("unrelated");
  });

  test("returns unrelated for empty hints", () => {
    const result = resolveSevereWeatherSource(hints({}));
    expect(result.status).toBe("unrelated");
  });
});

describe("resolveSevereWeatherSource — source identifier matching", () => {
  test("matches nhc.noaa.gov as an NHC source identifier", () => {
    const result = resolveSevereWeatherSource(hints({
      title: "Will a hurricane make landfall in 2026?",
      rulesPrimary: "Resolves per data at nhc.noaa.gov.",
    }));
    expect(result.status).toBe("supported");
    expect(result.source).toBe("NHC");
  });

  test("matches spc.noaa.gov as an SPC source identifier", () => {
    const result = resolveSevereWeatherSource(hints({
      title: "Will there be a tornado outbreak in 2026?",
      rulesPrimary: "Resolves per storm reports at spc.noaa.gov.",
    }));
    expect(result.status).toBe("supported");
    expect(result.source).toBe("SPC");
  });

  test("matches droughtmonitor.unl.edu as a Drought Monitor source identifier", () => {
    const result = resolveSevereWeatherSource(hints({
      title: "Will the US reach D4 exceptional drought in 2026?",
      rulesPrimary: "Resolves per the map at droughtmonitor.unl.edu.",
    }));
    expect(result.status).toBe("supported");
    expect(result.source).toBe("US Drought Monitor");
  });

  test("matches HURDAT as an NHC source identifier", () => {
    const result = resolveSevereWeatherSource(hints({
      title: "Will a Category 3 hurricane form in the Atlantic in 2026?",
      rulesPrimary: "Resolves per the HURDAT2 best track database.",
    }));
    expect(result.status).toBe("supported");
    expect(result.source).toBe("NHC");
  });

  test("does not match NOAA for a non-severe-weather market", () => {
    const result = resolveSevereWeatherSource(hints({
      title: "Will the Fed cut rates in September?",
      rulesPrimary: "Resolves per the FOMC statement, published by the Federal Reserve.",
    }));
    expect(result.status).toBe("unrelated");
  });

  test("does not treat a private weather company as a public source", () => {
    const result = resolveSevereWeatherSource(hints({
      title: "Will a Category 4 hurricane make landfall?",
      rulesPrimary: "Resolves per The Weather Company hurricane tracking data.",
      resolutionSource: "The Weather Company",
    }));
    // The Weather Company is a private source for daily climate, not NHC.
    // The hurricane keyword triggers the adapter, but the rules don't name NHC.
    expect(result.status).toBe("manual");
    expect(result.kind).toBe("hurricane");
  });
});
