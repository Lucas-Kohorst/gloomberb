/**
 * Share URL shapes, shared by the Cloudflare worker and the slim share page.
 *
 * The worker uses these to decide which document to serve, so this module must
 * stay free of browser and terminal imports.
 */

export const SHARE_HOSTED_ORIGIN = "https://terminal.kohor.st";
export const PUBLIC_SHARE_ORIGIN = SHARE_HOSTED_ORIGIN;

export function isStoredShareId(id: string): boolean {
  return /^[a-f0-9]{32}$/.test(id);
}

export function parseShareId(pathname: string): string | null {
  const id = parseShortShareId(pathname);
  return id && isStoredShareId(id) ? id : null;
}

export function publicShareUrl(id: string, origin = PUBLIC_SHARE_ORIGIN): string {
  if (!isStoredShareId(id)) throw new Error("Invalid share id.");
  return new URL(`/s/${id}`, origin).toString();
}

export function openLiveShareUrl(id: string, origin = PUBLIC_SHARE_ORIGIN): string {
  if (!isStoredShareId(id)) throw new Error("Invalid share id.");
  return new URL(`/api/shares/${id}/open`, origin).toString();
}

/**
 * Short-ID share: `/s/{id}`.
 *
 * Deliberately looser than the share API's own id check. An id that cannot
 * resolve should still reach the share page, which says the link expired —
 * rejecting it here would route the visitor into the terminal SPA instead, and
 * they would have to work out for themselves that the link was the problem.
 */
export function parseShortShareId(pathname: string): string | null {
  const match = pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
  return match?.[1] ?? null;
}

export function buildShortShareUrl(shortId: string): string {
  if (!parseShortShareId(`/s/${shortId}`) || shortId.includes("/")) throw new Error("Invalid share id.");
  return new URL(`/s/${shortId}`, SHARE_HOSTED_ORIGIN).toString();
}

export function buildInlineArticleShareUrl(encodedPayload: string): string {
  return `${SHARE_HOSTED_ORIGIN}/article?a=${encodeURIComponent(encodedPayload)}`;
}

/**
 * True for the paths that should be served the slim share document instead of
 * the terminal SPA.
 *
 * Matching on the path alone is deliberate: validating the payload would mean a
 * KV read before the first byte of HTML, and an unresolvable share still needs
 * a page to say so on.
 */
const LAYOUT_SHARE_PATH = /^\/l\/[a-f0-9]{32}\/?$/;

export function isLayoutSharePath(pathname: string): boolean {
  return LAYOUT_SHARE_PATH.test(pathname);
}

export const MAX_NEWS_ARTICLE_ID_LENGTH = 500;

/**
 * Godel-style public article page: `/news/reuters-urn:…`.
 *
 * Colons stay visible (RFC 3986 allows them in path segments). Everything else
 * that would break a path is percent-encoded.
 */
export function isCanonicalNewsId(id: string): boolean {
  return id.length > 0
    && id.length <= MAX_NEWS_ARTICLE_ID_LENGTH
    && id === id.trim()
    && !id.includes("/")
    && !id.includes("?")
    && !id.includes("#")
    && !id.includes("\0");
}

export function encodeNewsPathId(id: string): string {
  return encodeURIComponent(id).replace(/%3A/gi, ":").replace(/%40/g, "@");
}

export function parseNewsArticleId(pathname: string): string | null {
  const path = pathname.startsWith("/api/news/")
    ? `/news/${pathname.slice("/api/news/".length)}`
    : pathname;
  if (!path.startsWith("/news/")) return null;
  const raw = path.slice("/news/".length).replace(/\/$/, "");
  if (!raw || raw.includes("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isCanonicalNewsId(decoded) ? decoded : null;
}

export function publicNewsUrl(id: string, origin = PUBLIC_SHARE_ORIGIN): string {
  if (!isCanonicalNewsId(id)) throw new Error("Invalid news id.");
  return new URL(`/news/${encodeNewsPathId(id)}`, origin).toString();
}

export const ARTICLE_ID_HASH_LENGTH = 8;

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 8-character base64url of SHA-256(articleId). Hashes the full id so
 * `reuters-urn:` stories that share a prefix still get distinct URLs.
 */
export async function hashArticleId(articleId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(articleId));
  return base64urlFromBytes(new Uint8Array(digest).subarray(0, 6));
}

export function articleShareSlug(titleSlug: string, idHash: string): string {
  return `${titleSlug}--${idHash}`;
}

export function isArticleShareSlug(fullSlug: string): boolean {
  if (fullSlug.length < ARTICLE_ID_HASH_LENGTH + 3) return false;
  if (fullSlug.slice(-ARTICLE_ID_HASH_LENGTH - 2, -ARTICLE_ID_HASH_LENGTH) !== "--") return false;
  const titleSlug = fullSlug.slice(0, -ARTICLE_ID_HASH_LENGTH - 2);
  const idHash = fullSlug.slice(-ARTICLE_ID_HASH_LENGTH);
  return titleSlug.length > 0
    && titleSlug.length <= 60
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(titleSlug)
    && /^[A-Za-z0-9_-]{8}$/.test(idHash);
}

/**
 * Path segment after `/article/`, including `--{hash}`. That full string is
 * both the public URL slug and the KV index key.
 */
export function parseArticleSlugPath(pathname: string): string | null {
  const path = pathname.startsWith("/api/article-slug/")
    ? `/article/${pathname.slice("/api/article-slug/".length)}`
    : pathname;
  if (!path.startsWith("/article/")) return null;
  const raw = path.slice("/article/".length).replace(/\/$/, "");
  if (!raw || raw.includes("/")) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isArticleShareSlug(decoded) ? decoded : null;
}

export function buildArticleSlugUrl(titleSlug: string, idHash: string, origin = PUBLIC_SHARE_ORIGIN): string {
  return publicArticleSlugUrl(articleShareSlug(titleSlug, idHash), origin);
}

export function publicArticleSlugUrl(fullSlug: string, origin = PUBLIC_SHARE_ORIGIN): string {
  if (!isArticleShareSlug(fullSlug)) throw new Error("Invalid article slug.");
  return new URL(`/article/${fullSlug}`, origin).toString();
}

export function isShareDocumentPath(pathname: string): boolean {
  return pathname === "/article"
    || parseArticleSlugPath(pathname) !== null
    || parseShortShareId(pathname) !== null
    || isLayoutSharePath(pathname)
    || parseNewsArticleId(pathname) !== null;
}

/**
 * Share page JavaScript. The document is `no-store`, but a stable
 * `/share-main.js` URL can still be held as an immutable disk cache from an
 * older deploy — logged-in Work profiles kept the pre-autolink bundle while
 * incognito fetched the new one.
 */
export function isShareScriptPath(pathname: string): boolean {
  return pathname === "/share-main.js" || /^\/share-main\.[A-Za-z0-9_-]+\.js$/.test(pathname);
}

/**
 * Deep link that reopens a stored share inside the terminal. Used by the slim
 * page's "open in terminal" affordance and by the hand-off for shares the slim
 * page cannot draw itself.
 */
export function buildTerminalShareUrl(shortId: string, origin?: string): string {
  return terminalDeepLinkUrl(`gloomberb://share?s=${shortId}`, origin);
}

/** Terminal hand-off for an inline article share. */
export function buildTerminalArticleUrl(encodedPayload: string, origin?: string): string {
  return terminalDeepLinkUrl(`gloomberb://article?a=${encodedPayload}`, origin);
}

function terminalDeepLinkUrl(deepLink: string, origin?: string): string {
  return `${origin ?? SHARE_HOSTED_ORIGIN}/?gloomberb=${encodeURIComponent(deepLink)}`;
}
