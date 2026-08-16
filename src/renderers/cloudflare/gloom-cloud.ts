import { parseApiErrorMessage } from "../../api-client/errors";

export const SESSION_COOKIE = "__Host-gloom.session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const UPSTREAM_SESSION_COOKIES = ["__Secure-gloomberb.session_token", "gloomberb.session_token"] as const;

export function gloomApiBaseUrl(env: Env): string {
  return env.GLOOM_CLOUD_API_URL || "https://api.gloom.sh";
}

/** Server-side call to the Gloom Cloud API, attaching the user's session token when present. */
export async function gloomFetch(
  env: Env,
  path: string,
  init: { method?: string; body?: BodyInit | null; token?: string | null } = {},
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

/** Resolve the current Gloom Cloud user for the request, or null when unauthenticated. */
export async function fetchSessionUser(request: Request, env: Env): Promise<GloomSessionUser | null> {
  const token = readSessionCookie(request);
  if (!token) return null;
  const upstream = await gloomFetch(env, "/auth/get-session", { token });
  if (!upstream.ok) return null;
  const body = await upstream.json().catch(() => null) as { user?: GloomSessionUser } | null;
  return body?.user ?? null;
}
