import { describe, expect, test } from "bun:test";
import { colors } from "../../theme/colors";
import { getPredictionProbabilityColor } from "./metrics";

describe("getPredictionProbabilityColor", () => {
  test("keeps only the coin-flip band neutral", () => {
    expect(getPredictionProbabilityColor(0.4)).toBeUndefined();
    expect(getPredictionProbabilityColor(0.5)).toBeUndefined();
    expect(getPredictionProbabilityColor(0.6)).toBeUndefined();
    expect(getPredictionProbabilityColor(null)).toBeUndefined();
    expect(getPredictionProbabilityColor(0.399)).toBe(colors.negative);
    expect(getPredictionProbabilityColor(0.601)).toBe(colors.positive);
  });

  test("colors a real lean green or red", () => {
    expect(getPredictionProbabilityColor(0.69)).toBe(colors.positive);
    expect(getPredictionProbabilityColor(0.21)).toBe(colors.negative);
  });
});
