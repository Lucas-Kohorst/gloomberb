/**
 * Share URL shapes, shared by the Cloudflare worker and the slim share page.
 *
 * The worker uses these to decide which document to serve, so this module must
 * stay free of browser and terminal imports.
 */

export const SHARE_HOSTED_ORIGIN = "https://terminal.kohor.st";

/**
 * Short-ID share: `/s/{id}`.
 *
 * Deliberately looser than the share API's own id check. An id that cannot
 * resolve should still reach the share page, which says the link expired —
 * rejecting it here would route the visitor into the terminal SPA instead, and
 * they would have to work out for themselves that the link was the problem.
 */
export function parseShortShareId(pathname: string): string | null {
  const match = pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

export function buildShortShareUrl(shortId: string): string {
  return `${SHARE_HOSTED_ORIGIN}/s/${shortId}`;
}

export function buildInlineArticleShareUrl(encodedPayload: string): string {
  return `${SHARE_HOSTED_ORIGIN}/article?a=${encodedPayload}`;
}

/**
 * True for the paths that should be served the slim share document instead of
 * the terminal SPA.
 *
 * Matching on the path alone is deliberate: validating the payload would mean a
 * KV read before the first byte of HTML, and an unresolvable share still needs
 * a page to say so on.
 */
export function isShareDocumentPath(pathname: string): boolean {
  return pathname === "/article" || parseShortShareId(pathname) !== null;
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
