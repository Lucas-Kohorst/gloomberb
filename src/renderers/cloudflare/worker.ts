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
    if (url.pathname === "/api/byok/keys") return handleByokKeysRequest(request, env);
    if (url.pathname.startsWith("/api/auth/")) return handleAuthRequest(request, env, url);
    if (url.pathname.startsWith("/cloud/")) return proxyToGloomCloud(request, env, url);
    if (url.pathname.startsWith("/_gloomberb/")) return handleBackendRequest(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return serveApp(request, env);
  },
} satisfies ExportedHandler<Env>;

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

async function serveApp(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, max-age=0, must-revalidate");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
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
