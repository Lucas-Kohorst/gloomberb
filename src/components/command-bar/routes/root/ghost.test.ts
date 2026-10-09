import { describe, expect, test } from "bun:test";
import { shortcutGhostSuffix } from "./ghost";

describe("shortcutGhostSuffix", () => {
  test("keeps a lowercase shortcut and greys the inferred ticker", () => {
    expect(shortcutGhostSuffix("seg", "SEG IE")).toBe(" IE");
    expect(shortcutGhostSuffix("SEG", "SEG IE")).toBe(" IE");
    expect(shortcutGhostSuffix("SEG ", "SEG IE")).toBe("IE");
  });

  test("hides the hint once a ticker is being typed", () => {
    expect(shortcutGhostSuffix("SEG A", "SEG IE")).toBeNull();
    expect(shortcutGhostSuffix("seg ie", "SEG IE")).toBeNull();
  });

  test("uses the prompt's ticker name when it differs from the stored symbol", () => {
    expect(shortcutGhostSuffix("seg", "SEG FLUT", { displayTicker: "IE" })).toBe(" IE");
    expect(shortcutGhostSuffix("SEG ", "SEG FLUT", { displayTicker: "IE" })).toBe("IE");
  });
});
