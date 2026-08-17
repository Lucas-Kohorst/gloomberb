/**
 * Nested hosted routes serve the same index.html. Relative asset URLs resolve
 * under the route path, where the SPA fallback returns HTML instead of the file.
 */

const RELATIVE_ASSET_HREF = /(?:src|href)="(?!https?:|data:|\/)([^"]+)"/g;

export function findRelativeAssetUrls(html: string): string[] {
  return [...html.matchAll(RELATIVE_ASSET_HREF)]
    .map((match) => match[1])
    .filter((href): href is string => Boolean(href));
}

/** `./web-main.js` → `/web-main.js`; already-absolute paths pass through. */
export function toRootAbsoluteAssetUrl(href: string): string {
  if (href.startsWith("/")) return href;
  if (href.startsWith("./")) return `/${href.slice(2)}`;
  return `/${href}`;
}
