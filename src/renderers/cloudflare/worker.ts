import { handleHostedBackendRpc } from "./backend";
import {
  clearSessionCookieHeader,
  extractSessionToken,
  fetchSessionUser,
  gloomFetch,
  readSessionCookie,
  sessionCookieHeader,
} from "./gloom-cloud";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/api/share" || url.pathname.startsWith("/api/share/")) {
      return handleShareRequest(request, env, url);
    }
    if (url.pathname === "/api/config") return handleConfigSnapshotRequest(request, env);
    if (url.pathname === "/api/byok/keys") return handleByokKeysRequest(request, env);
    if (url.pathname === "/api/byok/proxy") return handleByokProxyRequest(request, env, url);
    if (url.pathname.startsWith("/api/auth/")) return handleAuthRequest(request, env, url);
    if (url.pathname.startsWith("/cloud/")) return proxyToGloomCloud(request, env, url);
    if (url.pathname.startsWith("/_gloomberb/")) return handleBackendRequest(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return serveApp(request, env);
  },
} satisfies ExportedHandler<Env>;

const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_SHARE_BODY_BYTES = 512_000;

async function handleShareRequest(request: Request, env: Env, url: URL): Promise<Response> {
  // Reads are public by design. Writes must carry a matching Origin: an absent
  // one cannot be trusted, or any non-browser client bypasses the check by
  // omitting the header.
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  if (request.method === "POST" && url.pathname === "/api/share") {
    if (!await fetchSessionUser(request, env)) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
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
    if (!body || (body.kind !== "article" && body.kind !== "chart") || body.data === undefined) {
      return Response.json({ error: "Invalid share payload." }, { status: 400 });
    }
    const id = `${crypto.randomUUID().replaceAll("-", "")}`;
    await env.SHARES.put(id, JSON.stringify({
      kind: body.kind,
      data: body.data,
      createdAt: new Date().toISOString(),
    }), { expirationTtl: SHARE_TTL_SECONDS });
    return Response.json({ id });
  }

  if (request.method === "GET") {
    const id = url.pathname.slice("/api/share/".length);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      return Response.json({ error: "Share not found." }, { status: 404 });
    }
    const value = await env.SHARES.get(id);
    if (!value) return Response.json({ error: "Share not found." }, { status: 404 });
    return new Response(value, { headers: { "content-type": "application/json" } });
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
    if (request.headers.get("Origin") !== new URL(request.url).origin) {
      return Response.json({ error: "Invalid origin" }, { status: 403 });
    }

    const rawBody = await request.text().catch(() => "");
    if (new TextEncoder().encode(rawBody).byteLength > CONFIG_SNAPSHOT_MAX_BYTES) {
      return Response.json({ error: "Config snapshot is too large." }, { status: 413 });
    }

    let body: { config?: unknown; updatedAt?: unknown } | null;
    try {
      body = JSON.parse(rawBody || "null") as { config?: unknown; updatedAt?: unknown } | null;
    } catch {
      return Response.json({ error: "Invalid config snapshot." }, { status: 400 });
    }
    if (!body || !isPlainObject(body.config) || typeof body.updatedAt !== "string") {
      return Response.json({ error: "Invalid config snapshot." }, { status: 400 });
    }

    const record = JSON.stringify({
      userId: user.id,
      updatedAt: body.updatedAt,
      config: body.config,
    });
    await env.SHARES.put(configSnapshotKey(user.id), record);
    return Response.json({ ok: true, updatedAt: body.updatedAt });
  }

  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (`${request.method} ${url.pathname}` !== "GET /api/auth/session") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return getSession(request, env);
}

async function getSession(request: Request, env: Env): Promise<Response> {
  const token = readSessionCookie(request);
  if (!token) return Response.json({ user: null });
  const upstream = await gloomFetch(env, "/auth/get-session", { token });
  if (!upstream.ok) {
    const headers = upstream.status === 401 || upstream.status === 404
      ? { "Set-Cookie": clearSessionCookieHeader() }
      : undefined;
    return Response.json({ user: null }, { headers });
  }
  const body = await upstream.json().catch(() => null) as { user?: unknown } | null;
  return Response.json({ user: body?.user ?? null });
}

async function proxyToGloomCloud(request: Request, env: Env, url: URL): Promise<Response> {
  const token = readSessionCookie(request);
  if (!isSameOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  const path = url.pathname.slice("/cloud".length) + url.search;
  const publicAuthPath = path === "/auth/sign-in/email" || path === "/auth/sign-up/email";
  if (!token && !publicAuthPath) return Response.json({ error: "Authentication required." }, { status: 401 });
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await gloomFetch(env, path, {
    method: request.method,
    body: hasBody ? request.body : null,
    token,
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
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function handleBackendRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && !isSameOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (url.pathname === "/_gloomberb/rpc") {
    const requestPayload = await request.clone().json().catch(() => null) as { method?: string } | null;
    const user = await fetchSessionUser(request, env);
    if (!user && requestPayload?.method !== "init") {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    return handleHostedBackendRpc(env, user, request);
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
  "connect-src 'self' https://api.gloom.sh",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

async function serveApp(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, max-age=0, must-revalidate");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy-report-only", APP_CSP);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Returns which BYOK service keys are configured as Cloudflare Worker secrets
 * (environment variables), without revealing the key values.
 *
 * Keys are set via `wrangler secret put ADJACENT_API_KEY` etc.
 */
function handleByokKeysRequest(request: Request, env: Env): Response {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
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
 * Gated behind a verified Gloom Cloud session and an exact Origin match:
 * without both, this route is an open proxy that would let anyone launder
 * arbitrary traffic through this worker.
 */
async function handleByokProxyRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  // Deliberately stricter than isSameOrigin(): an absent Origin must fail,
  // otherwise any non-browser client bypasses the check by omitting it.
  if (request.headers.get("Origin") !== url.origin) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
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
