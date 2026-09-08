/**
 * Scheme validation for links handed to the operating system.
 *
 * Opening a link natively means spawning `open` / `xdg-open` / `explorer`
 * with a string that usually came from an external feed: RSS items, prediction
 * markets, news, filings, Substack. Two things make an unvalidated string
 * dangerous there — `file://` launches local content, and a shell-based
 * opener on Windows routes the argument through cmd's parser.
 *
 * Restricting to http(s) removes both. Returns the normalised URL so callers
 * spawn the parsed form rather than the raw input.
 */
export function safeExternalUrl(value: string): string | null {
  if (!value.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

/**
 * Build the OS-specific opener command for an already-validated http(s) URL.
 *
 * On Windows this uses `explorer` (ShellExecute semantics) instead of
 * `cmd /c start`. cmd.exe reinterprets `&`, `|`, `<`, `>`, `^`, `(`, `)` and
 * `%` in an unquoted URL argument as command separators / metacharacters —
 * even a benign `?a=1&b=2` query misfires, and a crafted `&` payload yields
 * arbitrary command execution as the current user. `explorer` opens the URL
 * through the ShellExecute code path and never touches cmd's parser, so
 * those characters are safe in legitimate URLs.
 *
 * Returns `null` if the URL is empty.
 */
export function openUrlCommand(url: string): string[] | null {
  if (!url) return null;
  const platform = typeof process !== "undefined" ? process.platform : "linux";
  return platform === "darwin"
    ? ["open", url]
    : platform === "win32"
      ? ["explorer", url]
      : ["xdg-open", url];
}
