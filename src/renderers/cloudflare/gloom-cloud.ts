import { parseApiErrorMessage } from "../../api-client/errors";

export const SESSION_COOKIE = "__Host-gloom.session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const UPSTREAM_SESSION_COOKIES = ["__Secure-gloomberb.session_token", "gloomberb.session_token"] as const;

/**
 * Ceiling on any single upstream Gloom Cloud call. Without it a slow or
 * unreachable `api.gloom.sh` propagates straight into the hosted client's boot
 * path: session resolution runs before the first render, so an upstream request
 * that never settles leaves the app stuck on its loading placeholder forever.
 */
export const GLOOM_FETCH_TIMEOUT_MS = 8_000;

/**
 * Session resolution gates the first render, so it needs a ceiling — but not a
 * tight one. `/auth/get-session` has been observed taking 5-7s under load, and
 * failing faster than that would report a perfectly valid session as signed
 * out. The budget bounds the hang without inventing a sign-out.
 */
export const SESSION_FETCH_TIMEOUT_MS = 8_000;

export function gloomApiBaseUrl(env: Env): string {
  return env.GLOOM_CLOUD_API_URL || "https://api.gloom.sh";
}

/** Server-side call to the Gloom Cloud API, attaching the user's session token when present. */
export async function gloomFetch(
  env: Env,
  path: string,
  init: {
    method?: string;
    body?: BodyInit | null;
    token?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const baseUrl = gloomApiBaseUrl(env);
  const headers = new Headers();
  headers.set("Origin", baseUrl);
  if (init.body != null) headers.set("Content-Type", "application/json");
  if (init.token) {
    headers.set("Cookie", UPSTREAM_SESSION_COOKIES.map((name) => `${name}=${init.token}`).join("; "));
  }
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ?? null,
    signal: AbortSignal.timeout(init.timeoutMs ?? GLOOM_FETCH_TIMEOUT_MS),
  });
}

/** Extract the Gloom Cloud session token from an upstream response's Set-Cookie headers. */
export function extractSessionToken(headers: Headers): string | null {
  const setCookies = headers.getSetCookie?.() ?? [];
  const fallback = headers.get("set-cookie");
  if (fallback && setCookies.length === 0) setCookies.push(fallback);
  for (const cookie of setCookies) {
    for (const name of UPSTREAM_SESSION_COOKIES) {
      const match = cookie.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`));
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const prefix = `${SESSION_COOKIE}=`;
  for (const value of header.split(";")) {
    const entry = value.trim();
    if (entry.startsWith(prefix)) return entry.slice(prefix.length);
  }
  return null;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Relay an upstream error response as a normalized JSON error for the hosted client. */
export async function relayError(upstream: Response): Promise<Response> {
  const text = await upstream.text();
  return Response.json({ error: parseApiErrorMessage(text) || "Gloom Cloud request failed." }, { status: upstream.status });
}

export interface GloomSessionUser {
  id: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}

export interface SessionResolution {
  user: GloomSessionUser | null;
  /** Upstream never answered, so the session is unknown rather than invalid. */
  degraded: boolean;
  /** Upstream actively rejected the token, so the cookie is safe to clear. */
  rejected: boolean;
}

/**
 * Resolve the current Gloom Cloud user, separating "no valid session" from
 * "Gloom Cloud did not answer". The distinction matters because a degraded
 * upstream must not look like a sign-out: the cookie stays, and the client
 * boots in a degraded state instead of blocking or dropping the session.
 */
export async function resolveSessionUser(request: Request, env: Env): Promise<SessionResolution> {
  const token = readSessionCookie(request);
  if (!token) return { user: null, degraded: false, rejected: false };
  let upstream: Response;
  try {
    upstream = await gloomFetch(env, "/auth/get-session", {
      token,
      timeoutMs: SESSION_FETCH_TIMEOUT_MS,
    });
  } catch {
    return { user: null, degraded: true, rejected: false };
  }
  if (!upstream.ok) {
    const rejected = upstream.status === 401 || upstream.status === 404;
    return { user: null, degraded: !rejected, rejected };
  }
  const body = await upstream.json().catch(() => null) as { user?: GloomSessionUser } | null;
  return { user: body?.user ?? null, degraded: false, rejected: false };
}

/** Resolve the current Gloom Cloud user for the request, or null when unauthenticated. */
export async function fetchSessionUser(request: Request, env: Env): Promise<GloomSessionUser | null> {
  return (await resolveSessionUser(request, env)).user;
}
