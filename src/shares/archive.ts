/**
 * archive.is open URL for publisher articles.
 *
 * [a]rchive opens `https://archive.is/` + the publisher URL in a new tab.
 * archive.is itself shows a snapshot or “no results / archive this url.”
 * We never fetch archive.is, and we never archive a gloomberb share URL.
 */

export const ARCHIVE_IS_ORIGIN = "https://archive.is";

const ARCHIVE_HOSTS = new Set([
  "archive.is",
  "archive.today",
  "archive.ph",
  "archive.fo",
  "archive.md",
  "archive.li",
]);

export function publisherArticleUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "terminal.kohor.st" || host.endsWith(".kohor.st")) return null;
  if (ARCHIVE_HOSTS.has(host)) return null;
  return parsed.href;
}

export function archiveIsOpenUrl(raw: string | null | undefined): string | null {
  const publisher = publisherArticleUrl(raw);
  if (!publisher) return null;
  return `${ARCHIVE_IS_ORIGIN}/${publisher}`;
}
