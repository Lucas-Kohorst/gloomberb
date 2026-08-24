import { describe, expect, test } from "bun:test";
import {
  formatPredictionLoadError,
  getPredictionCatalogStatus,
  type PredictionCatalogSource,
} from "./status";
import type { PredictionMarketSummary } from "../types";

function source(
  overrides: Partial<PredictionCatalogSource> & Pick<PredictionCatalogSource, "venue">,
): PredictionCatalogSource {
  return {
    cacheKey: `${overrides.venue}:test`,
    error: null,
    markets: [],
    ...overrides,
  };
}

const MARKET = { key: "kalshi:X" } as PredictionMarketSummary;

describe("prediction catalog status", () => {
  // The venue sentence alone cost hours of debugging a blocked request: it looks
  // identical for a 429, a timeout and a content blocker.
  test("keeps the failing source's reason when another venue loaded", () => {
    const status = getPredictionCatalogStatus([
      source({ venue: "kalshi", error: "Kalshi markets request failed (429)." }),
      source({ venue: "polymarket", markets: [MARKET] }),
    ]);

    expect(status?.tone).toBe("warning");
    expect(status?.message).toBe(
      "Kalshi markets request failed (429). Showing Polymarket markets.",
    );
  });

  test("keeps the reason when the surviving venue returned nothing", () => {
    const status = getPredictionCatalogStatus([
      source({ venue: "kalshi", error: "Kalshi markets timed out." }),
      source({ venue: "polymarket" }),
    ]);

    expect(status?.message).toBe("Kalshi markets timed out.");
  });

  test("reports no status when every source loaded", () => {
    expect(
      getPredictionCatalogStatus([source({ venue: "kalshi", markets: [MARKET] })]),
    ).toBeNull();
  });
});

describe("prediction load error classification", () => {
  test("names a content blocker, which no retry can recover from", () => {
    expect(
      formatPredictionLoadError(
        "kalshi",
        "markets",
        new Error(
          "Request blocked by the browser (ERR_BLOCKED_BY_CLIENT) for /api/data/adjacent/markets",
        ),
      ),
    ).toBe("Kalshi markets blocked by a browser extension or content blocker.");
  });

  // Chrome's "Failed to fetch" shares no substring with Bun's "fetch failed",
  // so the hosted client fell through to raw error text before this.
  test.each([
    ["Failed to fetch", "Kalshi is unavailable right now."],
    ["NetworkError when attempting to fetch resource.", "Kalshi is unavailable right now."],
    ["Load failed", "Kalshi is unavailable right now."],
    ["Unable to connect. Was there a typo in the url or port?", "Kalshi is unavailable right now."],
  ])("classifies %p as a transport failure", (message, expected) => {
    expect(formatPredictionLoadError("kalshi", "markets", new Error(message))).toBe(expected);
  });

  test("separates a timeout from an unreachable venue", () => {
    expect(
      formatPredictionLoadError("kalshi", "markets", new Error("signal timed out")),
    ).toBe("Kalshi markets timed out.");
  });

  test("keeps the HTTP status when the server answered", () => {
    expect(
      formatPredictionLoadError(
        "polymarket",
        "market detail",
        new Error("Request failed (503) for https://gamma-api.polymarket.com/events"),
      ),
    ).toBe("Polymarket market detail request failed (503).");
  });
});
