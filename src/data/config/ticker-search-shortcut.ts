/**
 * Normalization for the configurable ticker-search command-bar shortcut.
 *
 * The shortcut is an *extra* command-bar prefix that opens ticker search next
 * to the defaults ("DES" with the "T" alias). Keeping the module free of any
 * component or plugin imports lets the config store, the CLI, and the
 * command-bar registry share one shape rule without pulling in renderers.
 */

export const DEFAULT_TICKER_SEARCH_SHORTCUT = "DES";
export const TICKER_SEARCH_SHORTCUT_MAX_LENGTH = 8;

const TICKER_SEARCH_SHORTCUT_PATTERN = /^[A-Z0-9]+$/;

/**
 * Trims, uppercases, and validates a configured ticker-search prefix.
 * Returns undefined when the value is missing, malformed (non-string, empty,
 * whitespace, too long, or containing anything but ASCII letters/digits) so
 * callers fall back to the DES/T defaults.
 */
export function normalizeTickerSearchShortcut(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TICKER_SEARCH_SHORTCUT_MAX_LENGTH) return undefined;
  const upper = trimmed.toUpperCase();
  return TICKER_SEARCH_SHORTCUT_PATTERN.test(upper) ? upper : undefined;
}

/** True when applying the value would change nothing (it is already claimed by the ticker-search command itself). */
export function isDefaultTickerSearchShortcut(value: string): boolean {
  return value === DEFAULT_TICKER_SEARCH_SHORTCUT || value === "T";
}
