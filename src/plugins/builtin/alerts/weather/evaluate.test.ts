import { describe, expect, test } from "bun:test";
import {
  evaluateMarketProbability,
  evaluateMarketSpread,
  evaluateObservedThresholdCrossing,
  evaluatePreliminaryToFinal,
  evaluateSourceDiscrepancy,
  evaluateStaleSource,
} from "./index";

const observation = (overrides: Record<string, unknown> = {}) => ({
  sourceId: "noaa",
  observationId: "obs-1",
  observedAt: 1_000,
  metric: "temperature-c",
  value: 20,
  ...overrides,
});

describe("weather alert primitives", () => {
  test("detects directional observed threshold crossings", () => {
    expect(evaluateObservedThresholdCrossing(
      { kind: "observed-threshold-crossing", metric: "temperature-c", threshold: 20, direction: "above" },
      observation({ value: 20 }),
      observation({ observationId: "obs-2", observedAt: 2_000, value: 21 }),
      2_000,
    ).triggered).toBe(true);
    expect(evaluateObservedThresholdCrossing(
      { kind: "observed-threshold-crossing", metric: "temperature-c", threshold: 20, direction: "above" },
      observation({ value: 19 }),
      observation({ observationId: "obs-2", observedAt: 2_000, value: 20 }),
      2_000,
    ).triggered).toBe(false);
  });

  test("marks only an older source reading stale", () => {
    const condition = { kind: "stale-source" as const, sourceId: "noaa", maxAgeMs: 500 };
    expect(evaluateStaleSource(condition, observation(), 1_501).triggered).toBe(true);
    expect(evaluateStaleSource(condition, observation({ sourceId: "other" }), 1_501).triggered).toBe(false);
  });

  test("detects preliminary to final transitions", () => {
    expect(evaluatePreliminaryToFinal(
      { kind: "preliminary-to-final", sourceId: "noaa" },
      observation({ status: "preliminary" }),
      observation({ status: "final", observationId: "obs-2" }),
      2_000,
    ).triggered).toBe(true);
  });

  test("evaluates market probability and spread with explicit units", () => {
    const market = { marketId: "m-1", sourceId: "kalshi", observationId: "quote-1", observedAt: 1_000 };
    expect(evaluateMarketProbability({ kind: "market-probability", ...market, operator: "at_or_above", threshold: 0.7 }, { ...market, probability: 0.7 }, 1_000).triggered).toBe(true);
    expect(evaluateMarketSpread({ kind: "market-spread", ...market, operator: "above", thresholdBps: 50 }, { ...market, spreadBps: 50 }, 1_000).triggered).toBe(false);
  });

  test("detects disagreement only between distinct sources at the same observation time", () => {
    expect(evaluateSourceDiscrepancy(
      { kind: "source-discrepancy", metric: "temperature-c", maxDifference: 2 },
      [observation({ value: 20 }), observation({ sourceId: "meteostat", observationId: "obs-2", value: 23 })],
      1_000,
    ).triggered).toBe(true);
  });
});
