import { readdir, readFile } from "fs/promises";
import { basename, extname, join } from "path";
import {
  DEFAULT_THEME,
  hasTheme,
  isCustomTheme,
  normalizeTheme,
  setCustomThemes,
  type Theme,
} from "./themes";

const THEME_COLOR_KEYS = [
  "bg",
  "panel",
  "border",
  "borderFocused",
  "text",
  "textDim",
  "textBright",
  "textMuted",
  "positive",
  "negative",
  "neutral",
  "warning",
  "header",
  "headerText",
  "selected",
  "selectedText",
  "commandBg",
  "commandBorder",
] as const;

type ThemeColorKey = typeof THEME_COLOR_KEYS[number];

export interface CustomThemeDocument {
  name: string;
  description: string;
  colors: Record<ThemeColorKey, string>;
}

export interface CustomThemeLoadError {
  file: string;
  message: string;
}

export interface CustomThemeLoadResult {
  themes: Record<string, Theme>;
  errors: CustomThemeLoadError[];
  missingThemeId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown key(s): ${unknown.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new Error(`${label} is missing required key(s): ${missing.join(", ")}`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Validate and normalize one user theme without applying any part of it.
 * Keeping this separate from filesystem access makes malformed files easy to
 * reject before they can alter the active registry.
 */
export function validateCustomTheme(value: unknown, source = "theme"): Theme {
  if (!isRecord(value)) {
    throw new Error(`${source} must be a JSON object`);
  }
  assertExactKeys(value, ["name", "description", "colors"], source);
  assertNonEmptyString(value.name, `${source}.name`);
  if (typeof value.description !== "string") {
    throw new Error(`${source}.description must be a string`);
  }
  if (!isRecord(value.colors)) {
    throw new Error(`${source}.colors must be an object`);
  }
  assertExactKeys(value.colors, THEME_COLOR_KEYS, `${source}.colors`);
  for (const key of THEME_COLOR_KEYS) {
    const color = value.colors[key];
    if (typeof color !== "string" || !HEX_COLOR.test(color)) {
      throw new Error(`${source}.colors.${key} must be a six-digit hex color`);
    }
  }

  return normalizeTheme({
    name: value.name,
    description: value.description,
    ...(value.colors as Record<ThemeColorKey, string>),
  });
}

export function themesDirectory(dataDir: string): string {
  return join(dataDir, "themes");
}

/**
 * Load all JSON themes from the active data directory. Invalid files are
 * rejected as whole documents and returned as clear errors; valid files are
 * applied only after every file has been parsed and validated.
 */
export async function loadCustomThemes(
  dataDir: string,
  selectedThemeId?: string,
): Promise<CustomThemeLoadResult> {
  const loaded: Record<string, Theme> = {};
  const errors: CustomThemeLoadError[] = [];
  const directory = themesDirectory(dataDir);

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      setCustomThemes({});
      return {
        themes: loaded,
        errors,
        missingThemeId: selectedThemeId && !hasTheme(selectedThemeId) ? selectedThemeId : null,
      };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    const file = join(directory, entry.name);
    const id = basename(entry.name, extname(entry.name));
    try {
      if (!id || (hasTheme(id) && !isCustomTheme(id))) {
        throw new Error(`theme id "${id}" conflicts with a built-in theme`);
      }
      const raw = await readFile(file, "utf-8");
      loaded[id] = validateCustomTheme(JSON.parse(raw), file);
    } catch (error) {
      errors.push({
        file,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  setCustomThemes(loaded);
  return {
    themes: loaded,
    errors,
    missingThemeId: selectedThemeId && !hasTheme(selectedThemeId) ? selectedThemeId : null,
  };
}

export function defaultThemeAfterMissing(selectedThemeId: string | undefined): string {
  return selectedThemeId && hasTheme(selectedThemeId) ? selectedThemeId : DEFAULT_THEME;
}
