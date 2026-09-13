import { HOSTED_CONFIG_SNAPSHOT_MAX_BYTES } from "../../shared/hosted-api";
import { handleHostedBackendRpc } from "./backend";
import {
  isShareDocumentPath,
  isShareScriptPath,
  isStoredShareId,
  parseNewsArticleId,
  parseShareId,
} from "../../shares/routes";
import {
  NEWS_INDEX_TTL_SECONDS,
  newsIndexKey,
  parseNewsIndexRecord,
  serializeNewsIndexRecord,
} from "../../shares/news-index";
import {
  MAX_SHARE_BYTES,
  articleShareFromStored,
  articleShareStoreData,
  decodeArticleSharePayload,
  parseSharePayload,
  type SharePayload,
} from "../../shares/payload";
import { injectShareDocumentMeta } from "../../shares/open-graph";
import { generateShareId, isShareId } from "../../shares/short-id";
import { handleKeyedDataRequest } from "./data-providers/handle";
import {
  KEYED_DATA_ALIAS_PATH,
  KEYED_DATA_PATH,
  TWC_KALSHI_ALIAS_PATH,
} from "./data-providers/types";
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
  stripUpstreamTokenBody,
  upstreamSessionCookieHeader,
} from "./gloom-cloud";
import { KALSHI_PROXY_PATH, KALSHI_SOURCE_HEADER } from "../../shared/hosted-api";
import {
  fetchKalshiListFromAdjacent,
  KALSHI_ORIGIN_FAILURE_STATUSES,
} from "./kalshi-adjacent-fallback";
import {
  hasTrustedHostedOrigin,
  hostedCorsHeaders,
  isTrustedHostedOrigin,
  isTrustedOrAbsentOrigin,
  withHostedCors,
} from "./hosted-origins";
import {
  proxyRobinhoodTokenRequest,
  renderRobinhoodOAuthCallbackPage,
  ROBINHOOD_OAUTH_CALLBACK_PATH,
  ROBINHOOD_OAUTH_TOKEN_PATH,
} from "./robinhood-oauth";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (url.pathname === "/api/shares" || url.pathname.startsWith("/api/shares/")) {
      return handleCloudSharesProxy(request, env, url);
    }
    if (url.pathname.startsWith("/api/news/")) {
      return handleNewsShareIndex(request, env, url).catch(() =>
        newsIndexResponse({ error: "News share temporarily unavailable." }, 503));
    }
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
      || url.pathname.startsWith(`${KEYED_DATA_ALIAS_PATH}/`)
      || url.pathname.startsWith(TWC_KALSHI_ALIAS_PATH)
    ) {
      return handleKeyedDataRequest(request, env, url);
    }
    if (url.pathname.startsWith("/api/auth/")) return handleAuthRequest(request, env, url);
    if (url.pathname.startsWith("/api/oauth/robinhood/")) return handleRobinhoodOAuthRequest(request, env, url);
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
    // share-main.js must not 304 the stale autolink-as-HTML bundle. Static
    // modules also skip the document validators so a missing chunk is not a
    // 304 of cached index.html.
    if (isShareScriptPath(url.pathname) || isStaticModulePath(url.pathname)) {
      return serveApp(request, env, url.pathname);
    }
    return serveApp(request, env);
  },
} satisfies ExportedHandler<Env>;

const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_SHARE_BODY_BYTES = MAX_SHARE_BYTES;
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

async function relayCloudShareResponse(upstream: Response, method: string): Promise<Response> {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const location = upstream.headers.get("location");
  if (location) headers.set("location", location);
  headers.set("cache-control", "private, no-store");
  const rotated = extractSessionToken(upstream.headers);
  if (rotated) {
    headers.set("Set-Cookie", sessionCookieHeader(rotated));
    headers.set("x-gloom-hosted-session", "1");
  }
  const bodyless = method === "HEAD" || [204, 205, 304].includes(upstream.status);
  const body = bodyless ? null : rotated ? await stripUpstreamTokenBody(upstream) : upstream.body;
  return new Response(body, { status: upstream.status, headers });
}

/** Public Cloud share API on this origin so the slim page does not call api.gloom.sh from the browser. */
async function handleCloudSharesProxy(request: Request, env: Env, url: URL): Promise<Response> {
  const upstreamPath = `/shares${url.pathname.slice("/api/shares".length)}${url.search}`;
  const isWrite = request.method !== "GET" && request.method !== "HEAD";
  if (isWrite && !hasTrustedHostedOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const token = readSessionCookie(request);
  if (isWrite && !token) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await gloomFetch(env, upstreamPath, {
    method: request.method,
    body: hasBody ? await request.text() : null,
    token,
    timeoutMs: GLOOM_CLOUD_PROXY_TIMEOUT_MS,
  });
  return relayCloudShareResponse(upstream, request.method);
}

const NEWS_INDEX_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

function newsIndexResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      ...NEWS_INDEX_CORS,
      "cache-control": "private, no-store",
    },
  });
}

async function readCloudShare(
  env: Env,
  shareId: string,
  token?: string | null,
  trackView = false,
): Promise<{ payload: SharePayload; body: Record<string, unknown> } | null> {
  const response = await gloomFetch(env, `/shares/${shareId}${trackView ? "" : "?purpose=open"}`, { timeoutMs: 2_500, token });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("Cloud share unavailable");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("Invalid Cloud share");
  const object = body as Record<string, unknown>;
  const payload = parseSharePayload({ kind: object.kind, data: object.data });
  if (!payload) throw new Error("Invalid Cloud share");
  return { payload, body: object };
}

async function loadIndexedNewsShare(
  env: Env,
  articleId: string,
  trackView = false,
): Promise<{ shareId: string; payload: SharePayload; body: Record<string, unknown> } | null> {
  const raw = await env.SHARES.get(newsIndexKey(articleId));
  const record = parseNewsIndexRecord(raw);
  if (!record) return null;
  const live = await readCloudShare(env, record.shareId, undefined, trackView);
  if (!live) {
    await env.SHARES.delete(newsIndexKey(articleId));
    return null;
  }
  const payload = record.verifiedArticle ?? await readTrustedNewsArticle(env, articleId);
  if (!payload || payload.kind !== "article" || payload.data.id !== articleId) return null;
  return { shareId: record.shareId, payload, body: live.body };
}

async function readTrustedNewsArticle(env: Env, articleId: string, token?: string | null): Promise<SharePayload | null> {
  const response = await gloomFetch(env, `/news/${encodeURIComponent(articleId)}`, { token, timeoutMs: 2_500 });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("News provider unavailable");
  const story: unknown = await response.json();
  if (!isPlainObject(story) || story.id !== articleId
    || typeof story.headline !== "string" || typeof story.summary !== "string"
    || typeof story.primaryUrl !== "string" || typeof story.primarySource !== "string") {
    throw new Error("Invalid news provider response");
  }
  // Canonical pages only display provider-owned content, never author snapshot fields.
  return parseSharePayload({ kind: "article", data: articleShareStoreData({
    type: "news", id: articleId, title: story.headline, summary: story.summary,
    url: story.primaryUrl, source: story.primarySource,
  }) });
}

async function handleNewsShareIndex(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: NEWS_INDEX_CORS });
  }

  const articleId = parseNewsArticleId(url.pathname);
  if (!articleId) return newsIndexResponse({ error: "Invalid news id." }, 400);

  if (request.method === "GET" || request.method === "HEAD") {
    const indexed = await loadIndexedNewsShare(env, articleId, request.method === "GET" && url.searchParams.get("purpose") !== "open");
    if (!indexed) return newsIndexResponse({ error: "Share not found." }, 404);
    const body = {
      ...indexed.body,
      shareId: indexed.shareId,
      kind: indexed.payload.kind,
      data: indexed.payload.data,
    };
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { ...NEWS_INDEX_CORS, "cache-control": "private, no-store", "content-type": "application/json" },
      });
    }
    return newsIndexResponse(body);
  }

  if (request.method !== "PUT") {
    return newsIndexResponse({ error: "Method not allowed." }, 405);
  }

  if (!hasTrustedHostedOrigin(request, url)) return newsIndexResponse({ error: "Invalid origin" }, 403);
  const token = readSessionCookie(request);
  if (!token || !await fetchSessionUser(request, env)) {
    return newsIndexResponse({ error: "Authentication required." }, 401);
  }

  let requestedShareId: string | null = null;
  try {
    const raw = await request.text();
    const parsed: unknown = JSON.parse(raw || "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const shareId = (parsed as { shareId?: unknown }).shareId;
      requestedShareId = typeof shareId === "string" ? shareId : null;
    }
  } catch {
    return newsIndexResponse({ error: "Invalid share payload." }, 400);
  }
  if (!requestedShareId || !isStoredShareId(requestedShareId)) {
    return newsIndexResponse({ error: "Invalid share id." }, 400);
  }

  const live = await readCloudShare(env, requestedShareId, token);
  if (!live) return newsIndexResponse({ error: "Share not found." }, 404);
  if (live.body.ownedByViewer !== true) return newsIndexResponse({ error: "Only the share owner can register it." }, 403);
  const verifiedArticle = await readTrustedNewsArticle(env, articleId, token);
  if (live.payload.kind !== "article" || live.payload.data.id !== articleId || !verifiedArticle) {
    return newsIndexResponse({ error: "Share does not match this article." }, 409);
  }

  // KV has no compare-and-set: verified registrations intentionally use last-write-wins.
  await env.SHARES.put(newsIndexKey(articleId), serializeNewsIndexRecord(requestedShareId, verifiedArticle), {
    expirationTtl: NEWS_INDEX_TTL_SECONDS,
  });
  return newsIndexResponse({ shareId: requestedShareId }, 201);
}

async function resolveSharePageMeta(
  request: Request,
  env: Env,
): Promise<{ title: string; description?: string } | null> {
  const url = new URL(request.url);
  if (url.pathname === "/article") {
    const encoded = url.searchParams.get("a");
    const article = encoded ? decodeArticleSharePayload(encoded) : null;
    if (!article) return null;
    return {
      title: article.title,
      description: typeof article.summary === "string" ? article.summary
        : typeof article.previewText === "string" ? article.previewText : undefined,
    };
  }
  const newsId = parseNewsArticleId(url.pathname);
  if (newsId) {
    const indexed = await loadIndexedNewsShare(env, newsId);
    if (!indexed) return null;
    if (indexed.payload.kind === "article") {
      const article = articleShareFromStored(indexed.payload.data);
      return { title: article.title, description: article.summary };
    }
    return { title: indexed.payload.data.title };
  }
  const id = parseShareId(url.pathname);
  if (!id) return null;
  const live = await readCloudShare(env, id);
  if (!live) return null;
  if (live.payload.kind === "article") {
    const article = articleShareFromStored(live.payload.data);
    return { title: article.title, description: article.summary };
  }
  return { title: live.payload.data.title };
}

const LEFTOVER_SHARE_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

function leftoverShareResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      ...LEFTOVER_SHARE_CORS,
      "cache-control": "private, no-store",
    },
  });
}

function isNativeShareClient(request: Request): boolean {
  return !request.headers.get("Origin") && !request.headers.get("Sec-Fetch-Site");
}

async function handleShareRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: LEFTOVER_SHARE_CORS });
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
    const payload = parseSharePayload(body);
    if (!payload) {
      return leftoverShareResponse({ error: "Invalid share payload." }, 400);
    }
    const { kind, data } = payload;
    const trustedOrigin = hasTrustedHostedOrigin(request, url);
    if (!trustedOrigin && !(kind === "article" && isNativeShareClient(request))) {
      return leftoverShareResponse({ error: "Invalid origin" }, 403);
    }
    // Articles are the public-share case (changelog, news, Substack) and must
    // work without a login. Charts/tables still require a session so anonymous
    // visitors cannot fill KV with large snapshots.
    if (kind !== "article" && !await fetchSessionUser(request, env)) {
      return leftoverShareResponse({ error: "Authentication required." }, 401);
    }
    if (kind === "article") {
      const budget = await env.ANONYMOUS_SHARE_WRITES.limit({
        key: request.headers.get("CF-Connecting-IP") || "unknown",
      });
      if (!budget.success) return leftoverShareResponse({ error: "Share limit reached. Try again shortly." }, 429);
    }
    const id = await allocateShareId(env);
    if (!id) {
      return leftoverShareResponse({ error: "Failed to allocate share id." }, 503);
    }
    await env.SHARES.put(id, JSON.stringify({
      kind,
      data,
      createdAt: new Date().toISOString(),
    }), { expirationTtl: SHARE_TTL_SECONDS });
    return leftoverShareResponse({ id });
  }

  if (request.method === "GET") {
    const id = url.pathname.slice("/api/share/".length);
    if (!isShareId(id)) {
      return leftoverShareResponse({ error: "Share not found." }, 404);
    }
    const value = await env.SHARES.get(id);
    if (!value) return leftoverShareResponse({ error: "Share not found." }, 404);
    return new Response(value, {
      headers: {
        ...LEFTOVER_SHARE_CORS,
        "content-type": "application/json",
        "cache-control": "private, no-store",
      },
    });
  }

  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

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
    if (new TextEncoder().encode(rawBody).byteLength > HOSTED_CONFIG_SNAPSHOT_MAX_BYTES) {
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
    if (!body || !isPlainObject(body.config) || typeof body.updatedAt !== "string"
      || !Number.isFinite(Date.parse(body.updatedAt))) {
      return Response.json({ error: "Invalid config snapshot." }, { status: 400 });
    }

    const existingRaw = await env.SHARES.get(configSnapshotKey(user.id));
    let existingTickers: unknown;
    let existingNotes: unknown;
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as { updatedAt?: string; tickers?: unknown; notes?: unknown };
        if (existing.updatedAt && Date.parse(existing.updatedAt) > Date.parse(body.updatedAt)) {
          return Response.json({ error: "A newer workspace snapshot is already saved." }, { status: 409 });
        }
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

async function handleRobinhoodOAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === ROBINHOOD_OAUTH_CALLBACK_PATH) {
    return new Response(renderRobinhoodOAuthCallbackPage(url), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (request.method === "OPTIONS" && url.pathname === ROBINHOOD_OAUTH_TOKEN_PATH) {
    const origin = request.headers.get("Origin");
    if (!origin || !isTrustedHostedOrigin(origin, url)) return invalidOriginResponse(request);
    return new Response(null, { status: 204, headers: hostedCorsHeaders(origin) });
  }
  if (request.method === "POST" && url.pathname === ROBINHOOD_OAUTH_TOKEN_PATH) {
    if (!hasTrustedHostedOrigin(request, url)) return invalidOriginResponse(request);
    const token = readSessionCookie(request);
    if (!token) {
      return withHostedCors(request, Response.json({ error: "Sign in to connect Robinhood." }, { status: 401 }));
    }
    const session = await gloomFetch(env, "/auth/get-session", { token });
    const sessionBody = session.ok
      ? await session.json().catch(() => null) as { user?: unknown } | null
      : null;
    if (!sessionBody?.user) {
      return withHostedCors(request, Response.json({ error: "Sign in to connect Robinhood." }, { status: 401 }));
    }
    return withHostedCors(request, await proxyRobinhoodTokenRequest(request));
  }
  return Response.json({ error: "Not found" }, { status: 404 });
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
  const servedPath = assetPath ?? new URL(request.url).pathname;
  const shareHtml = servedPath === "/share.html";
  const staticModule = isStaticModulePath(servedPath);
  let response = await env.ASSETS.fetch(assetsRequest(request, assetPath));
  if (shareHtml && response.status === 304) {
    response = await env.ASSETS.fetch(assetsRequest(request, assetPath));
  }
  const headers = new Headers(response.headers);
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("content-security-policy-report-only", APP_CSP);
  // SPA `not_found_handling` returns index.html 200 for missing files. A
  // module script that receives HTML throws "Failed to fetch dynamically
  // imported module" instead of a recoverable 404 after a deploy.
  if (staticModule && (response.status === 404 || isHtmlContentType(headers))) {
    headers.delete("etag");
    headers.delete("last-modified");
    headers.set("cache-control", "private, no-store");
    headers.set("content-type", "text/plain; charset=utf-8");
    return new Response("Not found", { status: 404, headers });
  }
  if (shareHtml) {
    // Shares are unlisted links rather than public pages, so keep crawlers out.
    headers.set("cache-control", "private, no-store");
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    // A 304 here would reuse the browser's cached body for `/s/{id}`. Logged-in
    // profiles still hold index.html from when this path was the SPA, so a
    // share.html ETag match (or a leftover index ETag) boots the workspace
    // instead of the public reader. Always send the share document.
    headers.delete("etag");
    headers.delete("last-modified");
    const status = response.status === 304 ? 200 : response.status;
    const meta = status === 200 ? await resolveSharePageMeta(request, env).catch(() => null) : null;
    if (meta) {
      const html = await response.text();
      headers.set("content-type", "text/html; charset=utf-8");
      return new Response(injectShareDocumentMeta(html, {
        title: meta.title,
        description: typeof meta.description === "string" ? meta.description : undefined,
      }), { status, headers });
    }
    return new Response(response.body, { status, headers });
  }
  headers.set(
    "cache-control",
    isContentHashedJsPath(servedPath) && response.ok
      ? "public, max-age=31536000, immutable"
      : "private, max-age=0, must-revalidate",
  );
  return new Response(response.body, { status: response.status, headers });
}

function isStaticModulePath(pathname: string): boolean {
  return /\.(?:js|css|map)$/i.test(pathname);
}

function isContentHashedJsPath(pathname: string): boolean {
  const file = pathname.split("/").pop() ?? "";
  return /^chunk-[A-Za-z0-9_-]+\.js$/.test(file)
    || /^(?:web-main|share-main)\.[A-Za-z0-9_-]+\.js$/.test(file);
}

function isHtmlContentType(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").toLowerCase().includes("text/html");
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
      if (next.url.origin !== current.origin) {
        return Response.json({ ok: false, error: "Redirects to a different origin are not allowed. Use the final API URL directly.", errorType: "blocked-target" });
      }
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
    if (
      !upstream.ok
      && KALSHI_ORIGIN_FAILURE_STATUSES.has(upstream.status)
    ) {
      const fallback = await fetchKalshiListFromAdjacent(upstreamPath, url.searchParams);
      if (fallback) return fallback;
    }
    const responseHeaders = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": KALSHI_SOURCE_HEADER,
      [KALSHI_SOURCE_HEADER]: "kalshi",
    });
    if (upstream.ok) {
      responseHeaders.set("cache-control", "public, max-age=60");
    } else {
      responseHeaders.set("cache-control", "no-store");
    }
    const status = KALSHI_ORIGIN_FAILURE_STATUSES.has(upstream.status) && upstream.status === 522
      ? 502
      : upstream.status;
    return new Response(upstream.body, {
      status,
      headers: responseHeaders,
    });
  } catch (error) {
    const fallback = await fetchKalshiListFromAdjacent(upstreamPath, url.searchParams);
    if (fallback) return fallback;
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
