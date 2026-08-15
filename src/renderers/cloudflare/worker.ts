import { handleHostedBackendRpc } from "./backend";
import {
  clearSessionCookieHeader,
  extractSessionToken,
  fetchSessionUser,
  gloomFetch,
  readSessionCookie,
  relayError,
  sessionCookieHeader,
} from "./gloom-cloud";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname.startsWith("/api/auth/")) return handleAuthRequest(request, env, url);
    if (url.pathname.startsWith("/cloud/")) return proxyToGloomCloud(request, env, url);
    if (url.pathname.startsWith("/_gloomberb/")) return handleBackendRequest(request, env, url);
    if (url.pathname === "/sign-out") return signOutPage(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    // Navigations validate the Gloom Cloud session upstream; static assets only
    // require the session cookie's presence since the app bundle is not secret.
    if (isNavigationRequest(request, url)) {
      const user = await fetchSessionUser(request, env);
      if (!user) return loginPage();
    } else if (!readSessionCookie(request)) {
      return loginPage();
    }
    return serveApp(request, env);
  },
} satisfies ExportedHandler<Env>;

function isNavigationRequest(request: Request, url: URL): boolean {
  if (url.pathname === "/" || url.pathname.endsWith(".html")) return true;
  return request.headers.get("sec-fetch-mode") === "navigate";
}

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && !isSameOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  try {
    switch (`${request.method} ${url.pathname}`) {
      case "POST /api/auth/sign-in":
        return relayCredentialAuth(request, env, "/auth/sign-in/email");
      case "POST /api/auth/sign-up":
        return relayCredentialAuth(request, env, "/auth/sign-up/email");
      case "POST /api/auth/sign-out":
        return relaySignOut(request, env);
      case "GET /api/auth/session":
        return getSession(request, env);
      default:
        return Response.json({ error: "Not found" }, { status: 404 });
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "cloud_auth_relay_error",
      path: url.pathname,
      message: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ error: "Authentication is temporarily unavailable." }, { status: 502 });
  }
}

async function relayCredentialAuth(request: Request, env: Env, upstreamPath: string): Promise<Response> {
  const payload = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 1_024) {
    return Response.json({ error: "A valid email and password are required." }, { status: 400 });
  }

  const isSignUp = upstreamPath.includes("sign-up");
  const body = isSignUp
    ? { email, password, name: email.split("@")[0] || email }
    : { email, password };
  const upstream = await gloomFetch(env, upstreamPath, { method: "POST", body: JSON.stringify(body) });
  if (!upstream.ok) return relayError(upstream);

  const token = extractSessionToken(upstream.headers);
  if (!token) {
    return Response.json({ error: "Gloom Cloud did not return a session." }, { status: 502 });
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json", "Set-Cookie": sessionCookieHeader(token) },
  });
}

async function relaySignOut(request: Request, env: Env): Promise<Response> {
  const token = readSessionCookie(request);
  if (token) {
    await gloomFetch(env, "/auth/sign-out", { method: "POST", body: "{}", token }).catch(() => null);
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
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
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!isSameOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  const path = url.pathname.slice("/cloud".length) + url.search;
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
  if (rotated) headers.set("Set-Cookie", sessionCookieHeader(rotated));
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function handleBackendRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && !isSameOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const user = await fetchSessionUser(request, env);
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (url.pathname === "/_gloomberb/rpc") {
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

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function loginPage(): Response {
  return new Response(LOGIN_PAGE_HTML, { headers: PAGE_HEADERS });
}

async function signOutPage(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await fetchSessionUser(request, env);
  if (!user) return Response.redirect(new URL("/", url), 303);
  return new Response(SIGN_OUT_PAGE_HTML, { headers: PAGE_HEADERS });
}

const PAGE_STYLES = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0e14; color: #e6e8ee; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  main { width: min(360px, 90vw); }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p.sub { margin: 0 0 24px; color: #8b93a5; }
  label { display: block; margin: 0 0 16px; color: #8b93a5; }
  input { display: block; width: 100%; margin-top: 6px; padding: 10px 12px; background: #131824; border: 1px solid #2a3245; border-radius: 6px; color: #e6e8ee; font: inherit; }
  input:focus { outline: none; border-color: #4c8dff; }
  .actions { display: flex; gap: 12px; margin-top: 24px; }
  button { flex: 1; padding: 10px 12px; border-radius: 6px; border: 1px solid #2a3245; font: inherit; cursor: pointer; }
  button.primary { background: #4c8dff; border-color: #4c8dff; color: #ffffff; }
  button.secondary { background: transparent; color: #e6e8ee; }
  button:disabled { opacity: 0.5; cursor: default; }
  #error { min-height: 20px; margin: 16px 0 0; color: #ff7a7a; }
  .hint { margin-top: 16px; color: #5c6474; font-size: 12px; }
`;

const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in · Gloomberb Cloud</title>
    <style>${PAGE_STYLES}</style>
  </head>
  <body>
    <main>
      <h1>Gloomberb</h1>
      <p class="sub">Sign in with your Gloom Cloud account.</p>
      <form id="auth-form">
        <label>Email <input name="email" type="email" autocomplete="email" required /></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
        <div class="actions">
          <button type="submit" id="sign-in" class="primary">Sign in</button>
          <button type="button" id="sign-up" class="secondary">Create account</button>
        </div>
        <p id="error" role="alert"></p>
      </form>
      <p class="hint">Uses your existing gloom.sh account, so your portfolios, layouts, and settings follow you here.</p>
    </main>
    <script>
      const form = document.getElementById("auth-form");
      const errorBox = document.getElementById("error");
      const buttons = form.querySelectorAll("button");
      async function submit(mode) {
        errorBox.textContent = "";
        for (const button of buttons) button.disabled = true;
        try {
          const response = await fetch("/api/auth/" + mode, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value }),
          });
          if (response.ok) {
            location.reload();
            return;
          }
          const body = await response.json().catch(() => ({}));
          errorBox.textContent = body.error || "Something went wrong. Try again.";
        } catch {
          errorBox.textContent = "Network error. Try again.";
        } finally {
          for (const button of buttons) button.disabled = false;
        }
      }
      form.addEventListener("submit", (event) => { event.preventDefault(); void submit("sign-in"); });
      document.getElementById("sign-up").addEventListener("click", () => { void submit("sign-up"); });
    </script>
  </body>
</html>`;

const SIGN_OUT_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign out · Gloomberb Cloud</title>
    <style>${PAGE_STYLES}</style>
  </head>
  <body>
    <main>
      <h1>Gloomberb</h1>
      <p class="sub">End your Gloom Cloud session on this device.</p>
      <form id="sign-out-form">
        <div class="actions">
          <button type="submit" class="primary">Sign out</button>
        </div>
      </form>
    </main>
    <script>
      document.getElementById("sign-out-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await fetch("/api/auth/sign-out", { method: "POST" });
        location.href = "/";
      });
    </script>
  </body>
</html>`;
