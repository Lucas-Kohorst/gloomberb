import { describe, expect, test } from "bun:test";
import { BASE_FONT_SIZE_PX, clampFontSize, MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX } from "./font-scale";

describe("clampFontSize", () => {
  test("keeps in-range sizes and falls back outside them", () => {
    expect(clampFontSize(12)).toBe(BASE_FONT_SIZE_PX);
    expect(clampFontSize(MIN_FONT_SIZE_PX)).toBe(MIN_FONT_SIZE_PX);
    expect(clampFontSize(MAX_FONT_SIZE_PX)).toBe(MAX_FONT_SIZE_PX);
    expect(clampFontSize(9)).toBe(MIN_FONT_SIZE_PX);
    expect(clampFontSize(48)).toBe(MAX_FONT_SIZE_PX);
    expect(clampFontSize("12")).toBe(BASE_FONT_SIZE_PX);
    expect(clampFontSize(Number.NaN)).toBe(BASE_FONT_SIZE_PX);
  });
});
