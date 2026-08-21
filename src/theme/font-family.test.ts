import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FONT_FAMILY,
  FONT_FAMILIES,
  getFontFamily,
  sanitizeFontFamily,
} from "./font-family";

describe("font family", () => {
  test("defaults to IBM Plex Sans and keeps a mono data stack", () => {
    expect(DEFAULT_FONT_FAMILY).toBe("ibm-plex-sans");
    const option = getFontFamily(DEFAULT_FONT_FAMILY);
    expect(option.uiStack).toContain("IBM Plex Sans");
    expect(option.dataStack).toContain("IBM Plex Mono");
    expect(option.uiStack.toLowerCase()).not.toContain("inter");
    expect(option.uiStack.toLowerCase()).not.toContain("roboto");
    expect(option.uiStack.toLowerCase()).not.toContain("arial");
    expect(option.uiStack.toLowerCase()).not.toContain("system-ui");
  });

  test("rejects unknown family ids", () => {
    expect(sanitizeFontFamily("inter")).toBe(DEFAULT_FONT_FAMILY);
    expect(sanitizeFontFamily(null)).toBe(DEFAULT_FONT_FAMILY);
    expect(sanitizeFontFamily("ibm-plex-mono")).toBe("ibm-plex-mono");
    expect(Object.keys(FONT_FAMILIES)).toEqual(["ibm-plex-sans", "ibm-plex-mono"]);
  });
});
