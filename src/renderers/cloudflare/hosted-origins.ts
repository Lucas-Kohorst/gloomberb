import { SHARE_HOSTED_ORIGIN } from "../../shares/routes";

/**
 * Public hostnames of the hosted SPA / gloomberb-cloud Worker. Requests may
 * arrive on the custom domain while the browser Origin is workers.dev (or the
 * reverse), so CSRF checks must accept both rather than only `request.url.origin`.
 */
export const HOSTED_WORKERS_DEV_ORIGIN = "https://gloomberb-cloud.kohorstlucas.workers.dev";

const WORKERS_DEV_ORIGIN_RE = /^https:\/\/gloomberb-cloud\.[a-z0-9-]+\.workers\.dev$/;
const LOCAL_DEV_ORIGIN_RE = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;

export function isTrustedHostedOrigin(origin: string | null, requestUrl: URL): boolean {
  if (!origin) return false;
  if (origin === requestUrl.origin) return true;
  if (origin === SHARE_HOSTED_ORIGIN) return true;
  if (origin === HOSTED_WORKERS_DEV_ORIGIN) return true;
  if (WORKERS_DEV_ORIGIN_RE.test(origin)) return true;
  if (LOCAL_DEV_ORIGIN_RE.test(origin)) return true;
  return false;
}

/**
 * CSRF gate for hosted Worker routes.
 *
 * Same-origin GET/HEAD from some browsers omit Origin; rejecting those broke
 * Gloom Cloud asset-data and `/sync/snapshot` after the strict `/cloud` check.
 * Mutating methods (and WebSocket upgrades) still require a trusted Origin.
 */
export function isTrustedOrAbsentOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return !origin || isTrustedHostedOrigin(origin, url);
}

export function hasTrustedHostedOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  const method = request.method.toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (!origin) {
    if (!mutating) return true;
    return isSameOriginFallback(request, url);
  }
  return isTrustedHostedOrigin(origin, url);
}

/**
 * Fallback same-origin check for browsers that omit the `Origin` header on
 * same-origin mutating requests (Firefox, Brave strict mode, privacy
 * extensions). `Sec-Fetch-Site` is browser-controlled and cannot be set or
 * overridden by JavaScript, so `same-origin` is a reliable CSRF signal. If the
 * header is absent (older browsers), fall back to comparing the `Referer`
 * origin against the request URL origin.
 */
function isSameOriginFallback(request: Request, url: URL): boolean {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "same-origin") return true;
  if (fetchSite && fetchSite !== "none") return false;
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === url.origin;
  } catch {
    return false;
  }
}

export function hostedCorsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    vary: "Origin",
  };
}

export function withHostedCors(request: Request, response: Response): Response {
  const origin = request.headers.get("Origin");
  if (!origin || !isTrustedHostedOrigin(origin, new URL(request.url))) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(hostedCorsHeaders(origin))) {
    if (key === "vary" && headers.has("vary")) {
      const existing = headers.get("vary") ?? "";
      if (!existing.toLowerCase().includes("origin")) {
        headers.set("vary", `${existing}, Origin`);
      }
    } else {
      headers.set(key, value);
    }
  }
  return new Response(response.body, { status: response.status, headers });
}
