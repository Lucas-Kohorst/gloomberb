import { describe, expect, test } from "bun:test";
import { cycleChoice, nextFontSize, themeChoices } from "./display";

describe("account display settings", () => {
  test("cycles theme ids", () => {
    expect(cycleChoice(["a", "b", "c"], "a", 1)).toBe("b");
    expect(cycleChoice(["a", "b", "c"], "c", 1)).toBe("a");
    expect(cycleChoice(["a", "b", "c"], "a", -1)).toBe("c");
  });

  test("lists Adjacent among themes and keeps font size bounds", () => {
    expect(themeChoices().some((choice) => choice.id === "adjacent")).toBe(true);
    expect(nextFontSize(12, 1)).toBe(13);
    expect(nextFontSize(20, 1)).toBe(20);
    expect(nextFontSize(10, -1)).toBe(10);
  });
});
