/**
 * archive.is lookup and submit URLs for publisher articles.
 *
 * Snapshot addresses are taken only from archive.is (Location or links in the
 * lookup page). Missing snapshots go to the submit URL. Blocked/rate-limited
 * lookups are errors — never a fabricated snapshot path.
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

const SNAPSHOT_PATH = /^\/(?:wip\/)?(?:[0-9]{8,14}|[A-Za-z0-9_-]{4,12})(?:\/|$)/;
const LOOKUP_PATH = /^\/https?:\/\//i;
const BLOCKED_RE = /just a moment|enable javascript and cookies|attention required|access denied|cf-mitigated|rate.?limit|too many requests|captcha/i;

export type ArticleArchiveResult =
  | { status: "snapshot"; url: string }
  | { status: "submit"; url: string }
  | { status: "error"; message: string };

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

export function archiveIsLookupUrl(sourceUrl: string): string {
  return `${ARCHIVE_IS_ORIGIN}/${sourceUrl}`;
}

export function archiveIsSubmitUrl(sourceUrl: string): string {
  return `${ARCHIVE_IS_ORIGIN}/submit/?url=${encodeURIComponent(sourceUrl)}`;
}

export function isArchiveSnapshotUrl(raw: string, base = ARCHIVE_IS_ORIGIN): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!ARCHIVE_HOSTS.has(parsed.hostname.toLowerCase())) return false;
  if (parsed.pathname === "/submit" || parsed.pathname.startsWith("/submit/")) return false;
  if (LOOKUP_PATH.test(parsed.pathname)) return false;
  return SNAPSHOT_PATH.test(parsed.pathname);
}

function firstSnapshotUrl(candidates: Array<string | null | undefined>, base?: string): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = new URL(candidate, base ?? ARCHIVE_IS_ORIGIN).href;
      if (isArchiveSnapshotUrl(resolved, base)) return resolved;
    } catch {
      continue;
    }
  }
  return null;
}

function snapshotUrlsFromHtml(html: string, base: string): string[] {
  const found: string[] = [];
  const hrefRe = /(?:href|content)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(hrefRe)) {
    const href = match[1];
    if (!href) continue;
    try {
      const resolved = new URL(href, base).href;
      if (isArchiveSnapshotUrl(resolved, base)) found.push(resolved);
    } catch {
      continue;
    }
  }
  return found;
}

export function parseArchiveLookupResponse(input: {
  sourceUrl: string;
  status: number;
  location: string | null;
  body: string;
  finalUrl?: string;
}): ArticleArchiveResult {
  const { sourceUrl, status, location, body, finalUrl } = input;
  const blocked = BLOCKED_RE.test(body);

  if (status === 429 || status === 403 || status === 503) {
    return {
      status: "error",
      message: status === 429
        ? "archive.is rate-limited this lookup."
        : "archive.is blocked this lookup.",
    };
  }

  if (status >= 300 && status < 400) {
    const snapshot = firstSnapshotUrl([location, finalUrl]);
    if (snapshot) return { status: "snapshot", url: snapshot };
    return { status: "submit", url: archiveIsSubmitUrl(sourceUrl) };
  }

  if (status === 404) return { status: "submit", url: archiveIsSubmitUrl(sourceUrl) };

  if (status < 200 || status >= 300) {
    return { status: "error", message: `archive.is lookup failed (${status}).` };
  }

  if (blocked) {
    return { status: "error", message: "archive.is blocked this lookup." };
  }

  const snapshot = firstSnapshotUrl(
    [finalUrl, location, ...snapshotUrlsFromHtml(body, finalUrl ?? ARCHIVE_IS_ORIGIN)],
    finalUrl ?? ARCHIVE_IS_ORIGIN,
  );
  if (snapshot) return { status: "snapshot", url: snapshot };
  return { status: "submit", url: archiveIsSubmitUrl(sourceUrl) };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function lookupArchiveIsSnapshot(
  sourceUrl: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<ArticleArchiveResult> {
  const publisher = publisherArticleUrl(sourceUrl);
  if (!publisher) {
    return { status: "error", message: "No publisher URL to archive." };
  }

  const lookupUrl = archiveIsLookupUrl(publisher);
  let response: Response;
  try {
    response = await fetchImpl(lookupUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "GloomberbArchiveLookup/1.0",
      },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "error", message: "Could not reach archive.is." };
  }

  const location = response.headers.get("location");
  const body = await response.text().catch(() => "");
  return parseArchiveLookupResponse({
    sourceUrl: publisher,
    status: response.status,
    location,
    body,
    finalUrl: response.url || lookupUrl,
  });
}
