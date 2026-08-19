import { describe, expect, test } from "bun:test";
import { impliedBucketMidpoint, kalshiWeightedImpliedTemp } from "./implied";

describe("kalshi temperature implied", () => {
  test("uses integer tails and the midpoint of a between bucket", () => {
    expect(impliedBucketMidpoint({ strikeType: "less", capStrike: 76, yesPrice: 0.01 })).toBe(75);
    expect(impliedBucketMidpoint({ strikeType: "between", floorStrike: 82, capStrike: 83, yesPrice: 0.63 })).toBe(82.5);
    expect(impliedBucketMidpoint({ strikeType: "greater", floorStrike: 83, yesPrice: 0.37 })).toBe(84);
  });

  test("weights live LA high buckets toward 82–83 vs 84+", () => {
    const forecast = kalshiWeightedImpliedTemp([
      { strikeType: "less", capStrike: 76, yesPrice: 0.01 },
      { strikeType: "between", floorStrike: 76, capStrike: 77, yesPrice: 0.01 },
      { strikeType: "between", floorStrike: 78, capStrike: 79, yesPrice: 0.01 },
      { strikeType: "between", floorStrike: 80, capStrike: 81, yesPrice: 0.01 },
      { strikeType: "between", floorStrike: 82, capStrike: 83, yesPrice: 0.63 },
      { strikeType: "greater", floorStrike: 83, yesPrice: 0.37 },
    ]);
    expect(forecast).not.toBeNull();
    expect(forecast!.implied).toBeCloseTo(82.85, 2);
    expect(forecast!.weightSum).toBeCloseTo(1.04, 2);
  });

  test("settled 0/1 books collapse to the paying bucket", () => {
    const forecast = kalshiWeightedImpliedTemp([
      { strikeType: "between", floorStrike: 82, capStrike: 83, yesPrice: 1 },
      { strikeType: "greater", floorStrike: 83, yesPrice: 0 },
    ]);
    expect(forecast?.implied).toBe(82.5);
  });
});
