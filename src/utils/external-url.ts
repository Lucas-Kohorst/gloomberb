import { parseHttpUrl } from "./url";

/**
 * Scheme validation for links handed to the operating system.
 *
 * Opening a link natively means spawning `open` / `xdg-open` / `cmd /c start`
 * with a string that usually came from an external feed: RSS items, prediction
 * markets, news, filings, Substack. Two things make an unvalidated string
 * dangerous there — `file://` launches local content, and Windows routes the
 * argument through cmd's parser.
 *
 * Restricting to http(s) removes both. Returns the normalised URL so callers
 * spawn the parsed form rather than the raw input.
 */
export function safeExternalUrl(value: string): string | null {
  const parsed = parseHttpUrl(value);
  return parsed ? parsed.toString() : null;
}
