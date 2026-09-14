import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import {
  defaultThemeAfterMissing,
  loadCustomThemes,
  validateCustomTheme,
} from "./custom-themes";
import { getTheme, setCustomThemes } from "./themes";

const palette = {
  bg: "#000000",
  panel: "#111111",
  border: "#222222",
  borderFocused: "#ffffff",
  text: "#eeeeee",
  textDim: "#bbbbbb",
  textBright: "#ffffff",
  textMuted: "#999999",
  positive: "#00cc66",
  negative: "#ff3333",
  neutral: "#888888",
  warning: "#ffaa00",
  header: "#222222",
  headerText: "#ffffff",
  selected: "#333333",
  selectedText: "#ffffff",
  commandBg: "#111111",
  commandBorder: "#ffffff",
};

const validTheme = {
  name: "Local Terminal",
  description: "A theme loaded from disk",
  colors: palette,
};

let tempDir: string | undefined;

afterEach(async () => {
  setCustomThemes({});
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("custom theme validator", () => {
  test("accepts a complete theme document", () => {
    const theme = validateCustomTheme(validTheme);
    expect(theme.name).toBe("Local Terminal");
    expect(theme.commandBorder).toBe("#ffffff");
  });

  test("rejects invalid hex colors", () => {
    expect(() => validateCustomTheme({
      ...validTheme,
      colors: { ...palette, bg: "black" },
    })).toThrow(".colors.bg must be a six-digit hex color");
  });

  test("rejects missing required keys", () => {
    const { warning: _warning, ...colors } = palette;
    expect(() => validateCustomTheme({ ...validTheme, colors }))
      .toThrow(".colors is missing required key(s): warning");
  });

  test("rejects unknown keys", () => {
    expect(() => validateCustomTheme({ ...validTheme, extra: true }))
      .toThrow("has unknown key(s): extra");
  });
});

describe("custom theme loading", () => {
  test("loads only valid JSON files from the selected data directory", async () => {
    tempDir = await mkdtemp(join("/tmp", "gloom-custom-themes-"));
    await mkdir(join(tempDir, "themes"));
    await writeFile(join(tempDir, "themes", "local.json"), JSON.stringify(validTheme));
    await mkdir(join(tempDir, "other", "themes"), { recursive: true });
    await writeFile(join(tempDir, "other", "themes", "ignored.json"), JSON.stringify(validTheme));
    const result = await loadCustomThemes(tempDir);

    expect(result.errors).toEqual([]);
    expect(result.themes.local?.name).toBe("Local Terminal");
    expect(result.themes.ignored).toBeUndefined();
    expect(getTheme("local").name).toBe("Local Terminal");
    expect(getTheme("ignored").name).toBe("White Phosphor");
  });

  test("reports a saved theme that is missing at boot and falls back to default", async () => {
    tempDir = await mkdtemp(join("/tmp", "gloom-custom-themes-"));
    const result = await loadCustomThemes(tempDir, "deleted-local");

    expect(result.missingThemeId).toBe("deleted-local");
    expect(defaultThemeAfterMissing(result.missingThemeId ?? undefined)).toBe("white");
  });
});
