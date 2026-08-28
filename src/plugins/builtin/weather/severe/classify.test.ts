import { describe, expect, test } from "bun:test";
import { classifySevereWeatherKind, isSevereWeatherMarket } from "./classify";
import type { SevereWeatherMarketHints } from "./types";

function hints(
  overrides: Partial<SevereWeatherMarketHints>,
): SevereWeatherMarketHints {
  return {
    venue: "kalshi",
    ...overrides,
  };
}

describe("severe weather kind classification", () => {
  test("classifies a hurricane market from the title", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will a Category 5 hurricane make landfall in the US in 2026?",
    }))).toBe("hurricane");
  });

  test("classifies a hurricane market from rules text", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will a named storm hit Florida?",
      rulesPrimary:
        "Resolves per the National Hurricane Center best track data for Atlantic tropical cyclones.",
    }))).toBe("hurricane");
  });

  test("classifies a tropical storm market as hurricane", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will a tropical storm form in the Gulf of Mexico in 2026?",
    }))).toBe("hurricane");
  });

  test("classifies a typhoon market as hurricane", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will a typhoon reach Category 4 strength in the western Pacific?",
    }))).toBe("hurricane");
  });

  test("classifies a tornado market from the title", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will there be more than 1,000 tornadoes in the US in 2026?",
    }))).toBe("tornado");
  });

  test("classifies a tornado outbreak market", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will a tornado outbreak occur in May 2026?",
    }))).toBe("tornado");
  });

  test("classifies a drought market from the title", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will more than 40% of the US be in drought by December 2026?",
    }))).toBe("drought");
  });

  test("classifies an exceptional drought market", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will any part of the US reach exceptional drought (D4) in 2026?",
    }))).toBe("drought");
  });

  test("classifies a wildfire market from the title", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will more than 8 million acres burn in US wildfires in 2026?",
    }))).toBe("wildfire");
  });

  test("classifies a wildfire market from rules text", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will California have a severe fire season?",
      rulesPrimary: "Resolves based on total wildland fire acreage burned.",
    }))).toBe("wildfire");
  });
});

describe("severe weather kind boundary behavior", () => {
  test("returns null for a daily high temperature market", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will the high temperature in Los Angeles be above 82.5°F on Aug 19?",
      rulesPrimary:
        "Resolves to The Weather Company Climatological Report (CLILAX) daily maximum temperature.",
      category: "Climate and Weather",
    }))).toBeNull();
  });

  test("returns null for a daily precipitation market", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will precipitation in Miami exceed 0.5 inches on Aug 19?",
      rulesPrimary: "Resolves to the Weather Company daily precipitation.",
    }))).toBeNull();
  });

  test("returns null for a CPI / macro market", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will CPI increase by more than 0.3% in August 2026?",
      rulesPrimary: "Resolves per BLS CPI-U.",
    }))).toBeNull();
  });

  test("returns null for an election market", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will the incumbent win the 2026 gubernatorial election?",
      category: "Politics",
    }))).toBeNull();
  });

  test("returns null for empty hints", () => {
    expect(classifySevereWeatherKind(hints({}))).toBeNull();
  });

  test("returns null for the Climate and Weather category label alone", () => {
    expect(classifySevereWeatherKind(hints({
      category: "Climate and Weather",
      title: "Will the Fed cut rates?",
    }))).toBeNull();
  });

  test("still classifies a hurricane market even with the Climate and Weather category", () => {
    expect(classifySevereWeatherKind(hints({
      category: "Climate and Weather",
      title: "Will a Category 4 hurricane make landfall in 2026?",
    }))).toBe("hurricane");
  });

  test("prefers hurricane when both hurricane and tornado keywords appear", () => {
    expect(classifySevereWeatherKind(hints({
      title: "Will hurricane-spawned tornadoes occur in 2026?",
    }))).toBe("hurricane");
  });

  test("isSevereWeatherMarket is true for a drought market and false for a macro market", () => {
    expect(isSevereWeatherMarket(hints({
      title: "Will the US Drought Monitor show D4 in California?",
    }))).toBe(true);
    expect(isSevereWeatherMarket(hints({
      title: "Will the Fed cut rates?",
    }))).toBe(false);
  });
});
