import { describe, expect, test } from "bun:test";
import { predictionDetailTabsFor } from "./navigation";

describe("prediction detail tabs", () => {
  test("shows Settlement only for Weather Company climate markets", () => {
    const weatherTabs = predictionDetailTabsFor({
      venue: "kalshi",
      seriesTicker: "KXHIGHLAX",
      eventTicker: "KXHIGHLAX-26AUG19",
      marketId: "KXHIGHLAX-26AUG19-B82.5",
      category: "Climate and Weather",
      title: "Highest temperature in Los Angeles on Aug 19, 2026?",
      description: "",
      rulesPrimary:
        "If the maximum temperature recorded at Los Angeles (CLILAX) for Aug 19, 2026, is less than 76° fahrenheit according to The Weather Company, then the market resolves to Yes.",
      resolutionSource: "The Weather Company",
    });
    expect(weatherTabs.some((tab) => tab.value === "settlement")).toBe(true);

    const fedTabs = predictionDetailTabsFor({
      venue: "kalshi",
      seriesTicker: "KXFED",
      eventTicker: "KXFED-26AUG",
      marketId: "KXFED-26AUG-T3.00",
      category: "Economics",
      title: "Will the Fed hike?",
      description: "",
      resolutionSource: "FOMC",
    });
    expect(fedTabs.some((tab) => tab.value === "settlement")).toBe(false);
  });
});
