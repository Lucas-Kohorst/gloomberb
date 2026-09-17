import { describe, expect, test } from "bun:test";
import {
  matchesPredictionSearchHaystack,
  normalizePredictionSearchQuery,
  predictionSearchTokens,
} from "./search";

describe("prediction pane search query", () => {
  test("strips a leaked search-chrome slash so /diesel matches command-bar diesel", () => {
    expect(normalizePredictionSearchQuery("/diesel")).toBe("diesel");
    expect(normalizePredictionSearchQuery("/ diesel")).toBe("diesel");
    expect(normalizePredictionSearchQuery("/// diesel")).toBe("diesel");
    expect(normalizePredictionSearchQuery("/")).toBe("");
    expect(normalizePredictionSearchQuery("? diesel")).toBe("diesel");
    expect(normalizePredictionSearchQuery("?diesel")).toBe("diesel");
    expect(normalizePredictionSearchQuery("?")).toBe("");
    expect(normalizePredictionSearchQuery("fed decision")).toBe("fed decision");
  });

  test("tokenizes punctuation so a slash is not an AND term", () => {
    expect(predictionSearchTokens("/diesel")).toEqual(["diesel"]);
    expect(predictionSearchTokens("/ diesel")).toEqual(["diesel"]);
    expect(predictionSearchTokens("? diesel")).toEqual(["diesel"]);
    expect(predictionSearchTokens("fed decision")).toEqual(["fed", "decision"]);
  });

  test("matches Kalshi diesel tickers the command bar compact-matches", () => {
    const haystack = [
      "will the u.s. eia weekly average diesel price be above $6.60",
      "kxdieselmon-26sep30-t6.60",
    ].join(" ");

    expect(matchesPredictionSearchHaystack(haystack, "diesel")).toBe(true);
    expect(matchesPredictionSearchHaystack(haystack, "/diesel")).toBe(true);
    expect(matchesPredictionSearchHaystack(haystack, "/ diesel")).toBe(true);
    expect(matchesPredictionSearchHaystack(haystack, "? diesel")).toBe(true);
    expect(matchesPredictionSearchHaystack("kxdieselmon-26sep30-t6.60", "diesel")).toBe(true);
  });
});
