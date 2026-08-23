/**
 * Hosted API route constants shared between the Cloudflare worker and clients.
 *
 * These paths are a client/server contract; changing them requires updating
 * both sides.
 */
export const KALSHI_PROXY_PATH = "/api/proxy/kalshi";

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
