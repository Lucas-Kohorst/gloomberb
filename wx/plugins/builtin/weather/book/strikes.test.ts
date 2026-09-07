import { describe, expect, test } from "bun:test";
import {
  bucketFromMarket,
  favoriteContainsSettlement,
  favoriteStrikeAtCutoff,
  strikeContainsTempF,
  yesPriceAtCutoff,
} from "./strikes";

describe("kalshi weather strike membership", () => {
  test("integer 79 sits in the 78-79 between bucket, not greater than 79", () => {
    const between = { kind: "between" as const, floor: 78, cap: 79 };
    const greater = { kind: "greater" as const, floor: 79 };
    expect(strikeContainsTempF(between, 79)).toBe(true);
    expect(strikeContainsTempF(between, 78)).toBe(false);
    expect(strikeContainsTempF(greater, 79)).toBe(false);
    expect(strikeContainsTempF(greater, 80)).toBe(true);
    expect(strikeContainsTempF({ kind: "less", cap: 72 }, 72)).toBe(true);
    expect(strikeContainsTempF({ kind: "less", cap: 72 }, 73)).toBe(false);
  });
});

describe("favorite strike at cutoff", () => {
  test("carry-forwards the last yes at or before cutoff and ignores later prints", () => {
    const priced = yesPriceAtCutoff(
      [
        { t: 100, yes: 0.2 },
        { t: 200, yes: 0.58 },
        { t: 300, yes: 0.99 },
      ],
      200,
    );
    expect(priced).toEqual({ t: 200, yes: 0.58 });
  });

  test("picks the highest yes, not the probability-weighted implied bucket", () => {
    const b78 = bucketFromMarket({
      ticker: "KXHIGHLAX-26AUG31-B78.5",
      strikeType: "between",
      floorStrike: 78,
      capStrike: 79,
    })!;
    const t79 = bucketFromMarket({
      ticker: "KXHIGHLAX-26AUG31-T79",
      strikeType: "greater",
      floorStrike: 79,
    })!;
    const favorite = favoriteStrikeAtCutoff(
      [b78, t79],
      [
        [{ t: 1, yes: 0.58 }],
        [{ t: 1, yes: 0.26 }],
      ],
      1,
    );
    expect(favorite?.bucket.ticker).toBe("KXHIGHLAX-26AUG31-B78.5");
    expect(favoriteContainsSettlement(favorite!, 79)).toBe(true);
    expect(favoriteContainsSettlement(favorite!, 80)).toBe(false);
  });

  test("does not let a 1c tail win when a live bucket has a later candle", () => {
    const tail = bucketFromMarket({
      ticker: "T77",
      strikeType: "less",
      capStrike: 77,
    })!;
    const pay = bucketFromMarket({
      ticker: "T84",
      strikeType: "greater",
      floorStrike: 84,
    })!;
    const favorite = favoriteStrikeAtCutoff(
      [tail, pay],
      [
        [{ t: 10, yes: 0.01 }],
        [{ t: 10, yes: 0.995 }],
      ],
      10,
    );
    expect(favorite?.bucket.ticker).toBe("T84");
  });
});
