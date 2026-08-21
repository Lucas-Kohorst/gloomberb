import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FONT_FAMILY,
  SYSTEM_MONO_STACK,
  getFontFamily,
  sanitizeFontFamily,
} from "./font-family";

describe("font family", () => {
  test("locks web/desktop to the original system monospace stack", () => {
    expect(DEFAULT_FONT_FAMILY).toBe("system-mono");
    const option = getFontFamily(DEFAULT_FONT_FAMILY);
    expect(option.uiStack).toBe(SYSTEM_MONO_STACK);
    expect(option.dataStack).toBe(SYSTEM_MONO_STACK);
    expect(option.uiStack).toBe('ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace');
    expect(option.uiStack.toLowerCase()).not.toContain("ibm plex");
    expect(option.uiStack.toLowerCase()).not.toContain("inter");
    expect(option.uiStack.toLowerCase()).not.toContain("roboto");
    expect(option.uiStack.toLowerCase()).not.toContain("arial");
    expect(option.uiStack.toLowerCase()).not.toContain("system-ui");
  });

  test("maps leftover plex and unknown family ids onto the original stack", () => {
    expect(sanitizeFontFamily("ibm-plex-sans")).toBe(DEFAULT_FONT_FAMILY);
    expect(sanitizeFontFamily("ibm-plex-mono")).toBe(DEFAULT_FONT_FAMILY);
    expect(sanitizeFontFamily("inter")).toBe(DEFAULT_FONT_FAMILY);
    expect(sanitizeFontFamily(null)).toBe(DEFAULT_FONT_FAMILY);
  });
});
