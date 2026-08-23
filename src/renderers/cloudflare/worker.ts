import { handleHostedBackendRpc } from "./backend";
import { isShareDocumentPath, isShareScriptPath } from "../../shares/routes";
import { SHARE_KINDS, type ShareKind } from "../../shares/payload";
import { generateShareId, isShareId } from "../../shares/short-id";
import { handleKeyedDataRequest } from "./data-providers/handle";
import { KEYED_DATA_PATH, TWC_KALSHI_ALIAS_PATH } from "./data-providers/types";
import {
  clearSessionCookieHeader,
  extractSessionToken,
  fetchSessionUser,
  gloomApiBaseUrl,
  gloomFetch,
  gloomCloudProxyUpstreamPath,
  GLOOM_CLOUD_PROXY_TIMEOUT_MS,
  readSessionCookie,
  relayError,
  resolveSessionUser,
  sessionCookieHeader,
  upstreamSessionCookieHeader,
} from "./gloom-cloud";
import { KALSHI_PROXY_PATH } from "../../shared/hosted-api";
import {
  hasTrustedHostedOrigin,
  hostedCorsHeaders,
  isTrustedHostedOrigin,
  isTrustedOrAbsentOrigin,
  withHostedCors,
} from "./hosted-origins";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/api/share" || url.pathname.startsWith("/api/share/")) {
      return handleShareRequest(request, env, url);
    }
    if (url.pathname === "/api/config") return handleConfigSnapshotRequest(request, env);
    if (url.pathname === "/api/byok/keys") return await handleByokKeysRequest(request, env);
    if (url.pathname === "/api/byok/proxy") return handleByokProxyRequest(request, env, url);
    if (url.pathname.startsWith(KALSHI_PROXY_PATH)) return handleKalshiProxyRequest(request, env, url);
    if (
      url.pathname === KEYED_DATA_PATH
      || url.pathname.startsWith(`${KEYED_DATA_PATH}/`)
      || url.pathname.startsWith(TWC_KALSHI_ALIAS_PATH)
    ) {
      return handleKeyedDataRequest(request, env, url);
    }
    if (url.pathname.startsWith("/api/auth/")) return handleAuthRequest(request, env, url);
    if (url.pathname === "/cloud/ws") return proxyGloomCloudWebSocket(request, env, url);
    if (url.pathname.startsWith("/cloud/")) return proxyToGloomCloud(request, env, url);
    if (url.pathname.startsWith("/_gloomberb/")) return handleBackendRequest(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    // Share URLs get the slim share document rather than the terminal SPA, so
    // opening a link does not download the whole workspace first.
    if (isShareDocumentPath(url.pathname)) return serveApp(request, env, "/share.html");
    // Same isolation as share.html: a logged-in If-None-Match for an older
    // share-main.js must not 304 the stale autolink-as-HTML bundle.
    if (isShareScriptPath(url.pathname)) return serveApp(request, env, url.pathname);
    return serveApp(request, env);
  },
} satisfies ExportedHandler<Env>;

const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_SHARE_BODY_BYTES = 512_000;
const SHARE_ID_MAX_ATTEMPTS = 5;

const KALSHI_API_ORIGIN = "https://external-api.kalshi.com/trade-api/v2";
const KALSHI_PROXY_TIMEOUT_MS = 12_000;

async function allocateShareId(env: Env): Promise<string | null> {
  for (let attempt = 0; attempt < SHARE_ID_MAX_ATTEMPTS; attempt += 1) {
    const id = generateShareId();
    if (await env.SHARES.get(id) == null) return id;
  }
  return null;
}

async function handleShareRequest(request: Request, env: Env, url: URL): Promise<Response> {
  // Reads are public by design. Writes must carry a matching Origin: an absent
  // one cannot be trusted, or any non-browser client bypasses the check by
  // omitting the header.
  if (request.method !== "GET" && !hasTrustedHostedOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  if (request.method === "POST" && url.pathname === "/api/share") {
    const rawBody = await request.text().catch(() => "");
    if (new TextEncoder().encode(rawBody).byteLength > MAX_SHARE_BODY_BYTES) {
      return Response.json({ error: "Share payload is too large." }, { status: 413 });
    }
    let body: { kind?: unknown; data?: unknown } | null;
    try {
      body = JSON.parse(rawBody || "null") as { kind?: unknown; data?: unknown } | null;
    } catch {
      return Response.json({ error: "Invalid share payload." }, { status: 400 });
    }
    if (!body || !SHARE_KINDS.includes(body.kind as never) || body.data === undefined) {
      return Response.json({ error: "Invalid share payload." }, { status: 400 });
    }
    const kind = body.kind as ShareKind;
    // Articles are the public-share case (changelog, news, Substack) and must
    // work without a login. Charts/tables still require a session so anonymous
    // visitors cannot fill KV with large snapshots.
    if (kind !== "article" && !await fetchSessionUser(request, env)) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    const id = await allocateShareId(env);
    if (!id) {
      return Response.json({ error: "Failed to allocate share id." }, { status: 503 });
    }
    await env.SHARES.put(id, JSON.stringify({
      kind,
      data: body.data,
      createdAt: new Date().toISOString(),
    }), { expirationTtl: SHARE_TTL_SECONDS });
    return Response.json({ id });
  }

  if (request.method === "GET") {
    const id = url.pathname.slice("/api/share/".length);
    if (!isShareId(id)) {
      return Response.json({ error: "Share not found." }, { status: 404 });
    }
    const value = await env.SHARES.get(id);
    if (!value) return Response.json({ error: "Share not found." }, { status: 404 });
    return new Response(value, {
      headers: {
        "content-type": "application/json",
        "cache-control": "private, no-store",
      },
    });
  }

  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

const CONFIG_SNAPSHOT_MAX_BYTES = 512_000;
const CONFIG_SNAPSHOT_KEY_PREFIX = "config:";

function configSnapshotKey(userId: string): string {
  return `${CONFIG_SNAPSHOT_KEY_PREFIX}${userId}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Authenticated GET/PUT for a signed-in user's config snapshot, stored in the
 * SHARES KV under a `config:{userId}` key. The user id is always derived from
 * the verified session server-side — a client cannot read or write another
 * user's snapshot.
 */
async function handleConfigSnapshotRequest(request: Request, env: Env): Promise<Response> {
  const user = await fetchSessionUser(request, env);
  if (!user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  if (request.method === "GET") {
    const raw = await env.SHARES.get(configSnapshotKey(user.id));
    if (!raw) return Response.json({ config: null, updatedAt: null });
    return new Response(raw, { headers: { "content-type": "application/json" } });
  }

  if (request.method === "PUT") {
    // Strict origin check: an absent Origin cannot be trusted, or any
    // non-browser client bypasses the check by omitting the header.
    if (!hasTrustedHostedOrigin(request, new URL(request.url))) {
      return Response.json({ error: "Invalid origin" }, { status: 403 });
    }

    const rawBody = await request.text().catch(() => "");
    if (new TextEncoder().encode(rawBody).byteLength > CONFIG_SNAPSHOT_MAX_BYTES) {
      return Response.json({ error: "Config snapshot is too large." }, { status: 413 });
    }

    let body: { config?: unknown; updatedAt?: unknown; tickers?: unknown; notes?: unknown } | null;
    try {
      body = JSON.parse(rawBody || "null") as {
        config?: unknown;
        updatedAt?: unknown;
        tickers?: unknown;
        notes?: unknown;
      } | null;
    } catch {
      return Response.json({ error: "Invalid config snapshot." }, { status: 400 });
    }
    if (!body || !isPlainObject(body.config) || typeof body.updatedAt !== "string") {
      return Response.json({ error: "Invalid config snapshot." }, { status: 400 });
    }

    const existingRaw = await env.SHARES.get(configSnapshotKey(user.id));
    let existingTickers: unknown;
    let existingNotes: unknown;
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as { tickers?: unknown; notes?: unknown };
        existingTickers = existing.tickers;
        existingNotes = existing.notes;
      } catch {
        // Keep going with the incoming body only.
      }
    }

    const record = JSON.stringify({
      userId: user.id,
      updatedAt: body.updatedAt,
      config: body.config,
      tickers: Array.isArray(body.tickers) ? body.tickers : existingTickers,
      notes: isPlainObject(body.notes) ? body.notes : existingNotes,
    });
    await env.SHARES.put(configSnapshotKey(user.id), record);
    return Response.json({ ok: true, updatedAt: body.updatedAt });
  }

  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

function invalidOriginResponse(request: Request): Response {
  return withHostedCors(request, Response.json({ error: "Invalid origin" }, { status: 403 }));
}

async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (`${request.method} ${url.pathname}` !== "GET /api/auth/session") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return getSession(request, env);
}

async function getSession(request: Request, env: Env): Promise<Response> {
  const resolved = await resolveSessionUser(request, env);
  // Only an explicit rejection clears the cookie. A degraded upstream leaves it
  // in place so the session survives the outage.
  const headers = resolved.rejected ? { "Set-Cookie": clearSessionCookieHeader() } : undefined;
  return Response.json({ user: resolved.user, degraded: resolved.degraded }, { headers });
}

async function proxyToGloomCloud(request: Request, env: Env, url: URL): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (!origin || !isTrustedHostedOrigin(origin, url)) return invalidOriginResponse(request);
    return new Response(null, { status: 204, headers: hostedCorsHeaders(origin) });
  }
  if (!hasTrustedHostedOrigin(request, url)) {
    return invalidOriginResponse(request);
  }

  const token = readSessionCookie(request);
  const path = gloomCloudProxyUpstreamPath(url.pathname, url.search);
  const publicAuthPath = path === "/auth/sign-in/email" || path === "/auth/sign-up/email";
  if (!token && !publicAuthPath) {
    return withHostedCors(request, Response.json({ error: "Authentication required." }, { status: 401 }));
  }

  // WebSocket upgrades cannot go through gloomFetch: it neither forwards the
  // Upgrade handshake nor relays the resulting 101, so hosted realtime never
  // connects. Relay the upgrade to api.gloom.sh with the server-held session,
  // so the socket authenticates upstream without the raw token ever reaching
  // the browser (it only holds the opaque hosted-session cookie). Unlike REST,
  // the upstream socket lives at `/cloud/ws`, so the full pathname is kept
  // rather than stripping the `/cloud` prefix.
  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return proxyGloomCloudWebSocket(request, env, url);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await gloomFetch(env, path, {
    method: request.method,
    body: hasBody ? request.body : null,
    token,
    timeoutMs: GLOOM_CLOUD_PROXY_TIMEOUT_MS,
  });

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  // Gloom Cloud may rotate the session token on any response; keep the local cookie in step.
  const rotated = extractSessionToken(upstream.headers);
  if (rotated) {
    headers.set("Set-Cookie", sessionCookieHeader(rotated));
    headers.set("x-gloom-hosted-session", "1");
  }
  if (path === "/auth/sign-out") headers.set("Set-Cookie", clearSessionCookieHeader());
  if (!upstream.ok) {
    return withHostedCors(request, await relayError(upstream));
  }
  // A rotating session (e.g. sign-in) also carries the raw token in the JSON
  // body. The hosted client authenticates purely through the HttpOnly cookie,
  // so strip the token before the body can reach browser JS.
  const body = rotated ? await stripUpstreamTokenBody(upstream) : upstream.body;
  return withHostedCors(request, new Response(body, { status: upstream.status, headers }));
}

/**
 * Relay a browser WebSocket upgrade to Gloom Cloud. Origin is already gated
 * for `/cloud/` by the caller; the dedicated `/cloud/ws` route checks it here.
 * The browser's own `__Host-gloom.session` cookie is dropped and replaced with
 * the real upstream session token server-side.
 */
async function proxyGloomCloudWebSocket(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isTrustedHostedOrigin(request.headers.get("Origin"), url)) {
    return invalidOriginResponse(request);
  }
  const token = readSessionCookie(request);
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });
  const baseUrl = gloomApiBaseUrl(env);
  const upstreamRequest = new Request(`${baseUrl}${url.pathname}${url.search}`, request);
  upstreamRequest.headers.delete("Cookie");
  upstreamRequest.headers.set("Cookie", upstreamSessionCookieHeader(token));
  upstreamRequest.headers.set("Origin", baseUrl);
  return fetch(upstreamRequest);
}

/**
 * Return the upstream JSON body with any top-level `token` removed. Falls back
 * to the raw text when the body is not a JSON object, so non-auth responses are
 * passed through untouched.
 */
async function stripUpstreamTokenBody(upstream: Response): Promise<string> {
  const text = await upstream.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isPlainObject(parsed) && "token" in parsed) {
      delete (parsed as Record<string, unknown>).token;
      return JSON.stringify(parsed);
    }
  } catch {
    // Not JSON — pass the original text through unchanged.
  }
  return text;
}

async function handleBackendRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && !isTrustedOrAbsentOrigin(request, url)) {
    return invalidOriginResponse(request);
  }
  if (url.pathname === "/_gloomberb/rpc") {
    const requestPayload = await request.clone().json().catch(() => null) as {
      method?: string;
      payload?: { init?: { method?: string } };
    } | null;
    // Public providers use the shared HTTP-fetch bridge, but do not need a
    // Gloom Cloud session for read-only requests. Resolving the session first
    // made every public request wait on a degraded api.gloom.sh and then fail
    // as 401. Mutating requests and authenticated RPC methods continue through
    // the verified-session gate. The hosted backend still enforces a token for
    // requests to api.gloom.sh.
    const httpMethod = requestPayload?.payload?.init?.method?.toUpperCase() ?? "GET";
    const isPublicHttpFetch = requestPayload?.method === "http.fetch"
      && (httpMethod === "GET" || httpMethod === "HEAD");
    const user = isPublicHttpFetch ? null : await fetchSessionUser(request, env);
    if (!user && requestPayload?.method !== "init" && !isPublicHttpFetch) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    const response = await handleHostedBackendRpc(env, user, request);
    response.headers.set("cache-control", "no-store, private");
    return response;
  }
  return Response.json({ error: "Realtime events are not available in the hosted client yet." }, { status: 501 });
}

/**
 * Sent as `content-security-policy-report-only`, so the browser reports what
 * this policy *would* block and blocks nothing.
 *
 * Enforcing it blind would be a silent outage: a blocked `connect-src` does
 * not raise an error in the UI, panes just stop loading data. The hosted
 * client talks to Yahoo, Adjacent, Polymarket, Kalshi, SEC, and RSS hosts,
 * and which of those the browser reaches directly versus through this Worker
 * has to be measured rather than guessed. `connect-src` is therefore
 * deliberately narrow here: violation reports are the inventory.
 *
 * `script-src` allows inline because the app's bootstrap script carries the
 * session token inline; moving to a nonce is the follow-up that lets
 * 'unsafe-inline' drop. `frame-src` allows YouTube because TV embeds it.
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.gloom.sh https://r.jina.ai",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

async function serveApp(request: Request, env: Env, assetPath?: string): Promise<Response> {
  const shareDocument = assetPath === "/share.html" || (assetPath != null && isShareScriptPath(assetPath));
  let response = await env.ASSETS.fetch(assetsRequest(request, assetPath));
  if (shareDocument && response.status === 304) {
    response = await env.ASSETS.fetch(assetsRequest(request, assetPath));
  }
  const headers = new Headers(response.headers);
  headers.set(
    "cache-control",
    shareDocument ? "private, no-store" : "private, max-age=0, must-revalidate",
  );
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy-report-only", APP_CSP);
  if (shareDocument) {
    // A 304 here would reuse the browser's cached body for `/s/{id}`. Logged-in
    // profiles still hold index.html from when this path was the SPA, so a
    // share.html ETag match (or a leftover index ETag) boots the workspace
    // instead of the public reader. Always send the share document.
    headers.delete("etag");
    headers.delete("last-modified");
    const status = response.status === 304 ? 200 : response.status;
    return new Response(response.body, { status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Static asset fetches must not inherit the document request's cookies or
 * cache validators. `/s/{id}` used to fall through to the SPA, so a logged-in
 * browser can still send `If-None-Match` for that cached index.html; forwarding
 * it onto `/share.html` 304s the wrong body and the terminal boots instead of
 * the snapshot. The same trap applies to `/share-main.js`: a stale ETag 304s
 * the bundle that treated plaintext autolinks as HTML.
 */
function assetsRequest(request: Request, assetPath?: string): Request {
  if (!assetPath) return request;
  const headers = new Headers();
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);
  headers.set("Cache-Control", "no-cache");
  return new Request(new URL(assetPath, request.url), { method: "GET", headers });
}

/**
 * Returns which BYOK service keys are configured as Cloudflare Worker secrets
 * (environment variables), without revealing the key values.
 *
 * Keys are set via `wrangler secret put ADJACENT_API_KEY` etc.
 */
async function handleByokKeysRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const resolved = await resolveSessionUser(request, env);
  if (!resolved.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const knownEnvVars = [
    "ADJACENT_API_KEY",
    "HYPERLIQUID_API_KEY",
    "SEC_EDGAR_EMAIL",
  ];

  const configured: Array<{ serviceId: string; envVar: string }> = [];
  for (const envVar of knownEnvVars) {
    if (env[envVar as keyof Env]) {
      const serviceId = envVar.toLowerCase().replace(/_api_key$|_email$/, "").replace(/_/g, "-");
      configured.push({ serviceId, envVar });
    }
  }

  return Response.json({ configured });
}

const BYOK_PROXY_TIMEOUT_MS = 10_000;
const BYOK_MAX_BODY_BYTES = 1_000_000;
const BYOK_MAX_REDIRECTS = 3;

/** Caller-supplied values for these would let the proxy spoof its own hop. */
const BYOK_BLOCKED_REQUEST_HEADERS = new Set([
  "cookie",
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
]);

/** Reflecting these to the browser would leak upstream credentials. */
const BYOK_BLOCKED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "www-authenticate",
  "proxy-authenticate",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Blocks loopback, RFC1918, CGNAT, and link-local targets. 169.254.0.0/16 in
 * particular covers the cloud instance metadata endpoint.
 */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

type ByokTarget = { url: URL } | { error: string; errorType: string };

function validateByokTarget(raw: string): ByokTarget {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: `Invalid URL: ${raw}`, errorType: "bad-url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `Unsupported protocol: ${parsed.protocol}`, errorType: "bad-url" };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return { error: "Requests to private or internal addresses are not allowed.", errorType: "blocked-target" };
  }
  return { url: parsed };
}

/**
 * Server-side proxy for BYOK custom API test requests. On the hosted web
 * client, a direct browser fetch to an arbitrary third-party URL is blocked
 * by CORS. This endpoint runs the fetch on the worker so it succeeds
 * regardless of the target's CORS headers, and returns a classified error
 * so the UI can show a precise, actionable message.
 *
 * Gated behind a verified Gloom Cloud session and a trusted hosted Origin:
 * without both, this route is an open proxy that would let anyone launder
 * arbitrary traffic through this worker.
 */
async function handleByokProxyRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  if (!hasTrustedHostedOrigin(request, url)) {
    return invalidOriginResponse(request);
  }

  const token = readSessionCookie(request);
  if (!token) {
    return Response.json({ error: "Sign in to test custom API keys." }, { status: 401 });
  }
  const session = await gloomFetch(env, "/auth/get-session", { token });
  const sessionBody = session.ok
    ? await session.json().catch(() => null) as { user?: unknown } | null
    : null;
  if (!sessionBody?.user) {
    return Response.json({ error: "Sign in to test custom API keys." }, { status: 401 });
  }

  let body: { url?: string; headers?: Record<string, string>; method?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const targetUrl = body.url;
  if (typeof targetUrl !== "string" || targetUrl.trim().length === 0) {
    return Response.json({ ok: false, error: "No API URL provided.", errorType: "bad-request" });
  }

  const target = validateByokTarget(targetUrl);
  if ("error" in target) return Response.json({ ok: false, ...target });

  const method = (body.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(body.headers ?? {})) {
    if (BYOK_BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json, text/csv, text/plain, */*");
  }

  try {
    // Redirects are followed by hand so every hop is re-validated; "follow"
    // would let a public URL bounce the proxy into a private address.
    let current = target.url;
    let response = await fetch(current.toString(), {
      method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(BYOK_PROXY_TIMEOUT_MS),
    });
    for (let hop = 0; response.status >= 300 && response.status < 400; hop += 1) {
      const location = response.headers.get("location");
      if (!location) break;
      if (hop >= BYOK_MAX_REDIRECTS) {
        return Response.json({ ok: false, error: "Too many redirects.", errorType: "network" });
      }
      const next = validateByokTarget(new URL(location, current).toString());
      if ("error" in next) return Response.json({ ok: false, ...next });
      current = next.url;
      response = await fetch(current.toString(), {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(BYOK_PROXY_TIMEOUT_MS),
      });
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (BYOK_BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) return;
      responseHeaders[key] = value;
    });
    const rawBody = await response.text();
    const truncated = rawBody.length > BYOK_MAX_BODY_BYTES;
    return Response.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      contentType: response.headers.get("content-type") ?? "",
      body: truncated ? rawBody.slice(0, BYOK_MAX_BODY_BYTES) : rawBody,
      truncated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let errorType = "network";
    if (message.includes("abort") || message.includes("timed out") || message.includes("timeout")) {
      errorType = "timeout";
    } else if (message.includes("ENOTFOUND") || message.includes("getaddrinfo") || message.includes("dns")) {
      errorType = "dns";
    } else if (message.includes("ECONNREFUSED") || message.includes("connection refused")) {
      errorType = "connection-refused";
    } else if (message.includes("SSL") || message.includes("certificate") || message.includes("TLS")) {
      errorType = "ssl";
    }
    return Response.json({ ok: false, error: message, errorType });
  }
}

/**
 * Server-side proxy for Kalshi read-only API requests.
 *
 * Kalshi's API rejects CORS preflight/origin headers from hosted origins,
 * so the browser cannot fetch it directly. This endpoint forwards GET/HEAD
 * requests to external-api.kalshi.com, strips the Origin header that causes
 * the 403, and adds CORS headers so the hosted client can read the response.
 *
 * Gated to trusted hosted origins to avoid turning the worker into an open
 * proxy; Kalshi API calls are read-only and carry no user secrets.
 */
async function handleKalshiProxyRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  if (!hasTrustedHostedOrigin(request, url)) {
    return invalidOriginResponse(request);
  }

  const upstreamPath = url.pathname.slice(KALSHI_PROXY_PATH.length).replace(/^\//, "");
  let target: URL;
  try {
    target = new URL(`${KALSHI_API_ORIGIN}/${upstreamPath}`);
  } catch {
    return Response.json({ error: "Invalid proxy path." }, { status: 400 });
  }
  if (target.protocol !== "https:" || isPrivateHostname(target.hostname)) {
    return Response.json({ error: "Blocked target." }, { status: 403 });
  }
  target.search = url.search;

  const upstreamHeaders = new Headers({
    Accept: request.headers.get("Accept") ?? "application/json",
    "User-Agent": request.headers.get("User-Agent") ?? "gloomberb-cloud/1.0",
  });
  const acceptEncoding = request.headers.get("Accept-Encoding");
  if (acceptEncoding) upstreamHeaders.set("Accept-Encoding", acceptEncoding);
  const acceptLanguage = request.headers.get("Accept-Language");
  if (acceptLanguage) upstreamHeaders.set("Accept-Language", acceptLanguage);

  try {
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(KALSHI_PROXY_TIMEOUT_MS),
    });
    const responseHeaders = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "access-control-allow-origin": "*",
    });
    if (upstream.ok) {
      responseHeaders.set("cache-control", "public, max-age=60");
    } else {
      responseHeaders.set("cache-control", "no-store");
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: message },
      {
        status: 502,
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      },
    );
  }
}
