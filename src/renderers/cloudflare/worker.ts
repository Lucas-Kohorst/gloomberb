const SESSION_COOKIE = "__Host-gloomberb.session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_BYTES = 32;

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
};

type SessionUser = {
  id: string;
  email: string;
};

type AuthPayload = {
  email?: unknown;
  password?: unknown;
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname.startsWith("/api/auth/")) return handleAuthRequest(request, env, url);
    if (url.pathname.startsWith("/_gloomberb/")) return handleBackendRequest(request, env);
    if (url.pathname === "/sign-out") return signOutPage(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const user = await sessionUser(request, env);
    if (!user) return loginPage();
    return serveApp(request, env);
  },
} satisfies ExportedHandler<Env>;

async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && !isSameOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  try {
    switch (`${request.method} ${url.pathname}`) {
      case "POST /api/auth/sign-up":
        return signUp(request, env);
      case "POST /api/auth/sign-in":
        return signIn(request, env);
      case "POST /api/auth/sign-out":
        return signOut(request, env);
      case "GET /api/auth/session":
        return getSession(request, env);
      default:
        return Response.json({ error: "Not found" }, { status: 404 });
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "cloud_auth_error",
      path: url.pathname,
      message: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ error: "Authentication is temporarily unavailable." }, { status: 500 });
  }
}

async function handleBackendRequest(request: Request, env: Env): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  return Response.json({ error: "The hosted Gloomberb backend is not available yet." }, { status: 501 });
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
  const user = await sessionUser(request, env);
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
      <h1>Gloomberb Cloud</h1>
      <p class="sub">Sign in to your hosted terminal.</p>
      <form id="auth-form">
        <label>Email <input name="email" type="email" autocomplete="email" required /></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required minlength="12" /></label>
        <div class="actions">
          <button type="submit" id="sign-in" class="primary">Sign in</button>
          <button type="button" id="sign-up" class="secondary">Create account</button>
        </div>
        <p id="error" role="alert"></p>
      </form>
      <p class="hint">Passwords must be at least 12 characters.</p>
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
      <h1>Gloomberb Cloud</h1>
      <p class="sub">End your session on this device.</p>
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

async function signUp(request: Request, env: Env): Promise<Response> {
  const credentials = await readCredentials(request);
  if (!credentials) return Response.json({ error: "A valid email and password are required." }, { status: 400 });

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(credentials.email).first<{ id: string }>();
  if (existing) return Response.json({ error: "Unable to create account." }, { status: 409 });

  const salt = randomToken();
  const passwordHash = await hashPassword(credentials.password, salt);
  const user: SessionUser = { id: crypto.randomUUID(), email: credentials.email };
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(user.id, user.email, passwordHash, salt, now, now).run();

  return createSessionResponse(env, user, 201);
}

async function signIn(request: Request, env: Env): Promise<Response> {
  const credentials = await readCredentials(request);
  if (!credentials) return Response.json({ error: "Invalid email or password." }, { status: 401 });

  const user = await env.DB.prepare(
    "SELECT id, email, password_hash, password_salt FROM users WHERE email = ?",
  ).bind(credentials.email).first<UserRow>();
  if (!user || !constantTimeEqual(await hashPassword(credentials.password, user.password_salt), user.password_hash)) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  return createSessionResponse(env, { id: user.id, email: user.email });
}

async function signOut(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

async function getSession(request: Request, env: Env): Promise<Response> {
  const user = await sessionUser(request, env);
  return Response.json({ user });
}

async function createSessionResponse(env: Env, user: SessionUser, status = 200): Promise<Response> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).bind(await hashToken(token), user.id, now + SESSION_TTL_SECONDS * 1_000, now).run();
  return Response.json(
    { user },
    { status, headers: { "Set-Cookie": sessionCookie(token) } },
  );
}

async function sessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) return null;
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT users.id, users.email, sessions.expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`,
  ).bind(await hashToken(token)).first<SessionUser & { expires_at: number }>();
  if (!row) return null;
  if (row.expires_at <= now) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
    return null;
  }
  return { id: row.id, email: row.email };
}

async function readCredentials(request: Request): Promise<{ email: string; password: string } | null> {
  const payload = await request.json().catch(() => null) as AuthPayload | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 1_024) return null;
  return { email, password };
}

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const prefix = `${name}=`;
  for (const value of header.split(";")) {
    const entry = value.trim();
    if (entry.startsWith(prefix)) return entry.slice(prefix.length);
  }
  return null;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

async function hashToken(token: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: decodeBase64Url(salt), iterations: PASSWORD_ITERATIONS },
    material,
    PASSWORD_BYTES * 8,
  );
  return toBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  const buffer = new ArrayBuffer(decoded.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return buffer;
}
