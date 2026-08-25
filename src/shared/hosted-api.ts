/**
 * Hosted API route constants shared between the Cloudflare worker and clients.
 *
 * These paths are a client/server contract; changing them requires updating
 * both sides.
 */
export const KALSHI_PROXY_PATH = "/api/proxy/kalshi";

/** Set by `/api/proxy/kalshi` so the client can tell live Kalshi from Adjacent fallback. */
export const KALSHI_SOURCE_HEADER = "x-gloom-kalshi-source";
export type KalshiSourceKind = "kalshi" | "adjacent";

/** Keyed-data route, plus a twin that ad/tracker filter lists do not match. */
export const KEYED_DATA_PATH = "/api/data";
export const KEYED_DATA_ALIAS_PATH = "/api/feed";

/** Blocker-safe slug for the `adjacent` provider id under the alias route. */
export const ADJACENT_DATA_ALIAS_ID = "mkt";

/**
 * True when the app is running on the hosted Cloudflare web client.
 *
 * The check is wrapped in a try/catch so it can be evaluated during server
 * rendering or test environments where `globalThis` may not be available.
 */
export function isHostedWebClient(): boolean {
  try {
    return (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED === true;
  } catch {
    return false;
  }
}
