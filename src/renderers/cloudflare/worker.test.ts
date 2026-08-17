import { afterEach, describe, expect, test } from "bun:test";

/**
 * Tests for the hosted config snapshot Worker endpoints.
 *
 * These exercise the request handler logic with a minimal in-memory Env mock,
 * verifying that:
 * - A user can read and write their own snapshot.
 * - One user cannot read another user's snapshot (userId is derived from the
 *   session, never from the request body).
 * - An unauthenticated request is rejected.
 * - An invalid payload shape is rejected.
 * - A write with a mismatched Origin is rejected.
 * - An oversized body is rejected.
 */

const SNAPSHOTS = new Map<string, string>();
const ORIGIN = "https://terminal.kohor.st";
const SESSION_COOKIE = "__Host-gloom.session";

let mockSessionUser: { id: string } | null = null;
const originalFetch = globalThis.fetch;

function makeEnv(): Env {
  return {
    SHARES: {
      get: async (key: string) => SNAPSHOTS.get(key) ?? null,
      put: async (key: string, value: string) => { SNAPSHOTS.set(key, value); },
      delete: async (key: string) => { SNAPSHOTS.delete(key); },
      list: async () => [],
    } as unknown as KVNamespace,
    ASSETS: { fetch: async () => new Response("ok") } as unknown as Fetcher,
    GLOOM_CLOUD_API_URL: "https://api.gloom.sh",
  } as Env;
}

function makeRequest(
  method: string,
  path: string,
  options: { body?: string; origin?: string; sessionToken?: string | null } = {},
): Request {
  const headers = new Headers();
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  if (options.sessionToken) {
    headers.set("Cookie", `${SESSION_COOKIE}=${options.sessionToken}`);
  }
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: options.body,
  });
}

function installMockFetch(): void {
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    if (url.pathname === "/auth/get-session") {
      if (!mockSessionUser) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ user: mockSessionUser }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof globalThis.fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

const workerModule = await import("./worker");

describe("hosted config snapshot Worker endpoint", () => {
  afterEach(() => {
    SNAPSHOTS.clear();
    mockSessionUser = null;
    restoreFetch();
  });

  test("a user can write and read their own snapshot", async () => {
    mockSessionUser = { id: "user-A" };
    installMockFetch();
    const env = makeEnv();
    const configPayload = { theme: "amber", baseCurrency: "EUR" };
    const putBody = JSON.stringify({ config: configPayload, updatedAt: "2026-08-17T12:00:00.000Z" });

    const putResponse = await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", { body: putBody, origin: ORIGIN, sessionToken: "tok" }),
      env,
    );
    expect(putResponse?.status).toBe(200);

    const getResponse = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/config", { sessionToken: "tok" }),
      env,
    );
    expect(getResponse?.status).toBe(200);
    const body = await getResponse?.json();
    expect(body.config).toEqual(configPayload);
    expect(body.updatedAt).toBe("2026-08-17T12:00:00.000Z");
  });

  test("one user cannot read another user's snapshot", async () => {
    // user-A writes a snapshot
    mockSessionUser = { id: "user-A" };
    installMockFetch();
    const env = makeEnv();
    const putBody = JSON.stringify({ config: { secret: "user-A-data" }, updatedAt: "2026-08-17T12:00:00.000Z" });
    await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", { body: putBody, origin: ORIGIN, sessionToken: "tok" }),
      env,
    );

    // user-B reads — the KV key is config:user-B, not config:user-A
    mockSessionUser = { id: "user-B" };
    const getResponse = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/config", { sessionToken: "tok" }),
      env,
    );
    expect(getResponse?.status).toBe(200);
    const body = await getResponse?.json();
    expect(body.config).toBeNull();
    expect(body.updatedAt).toBeNull();
  });

  test("rejects unauthenticated requests", async () => {
    mockSessionUser = null;
    installMockFetch();
    const env = makeEnv();

    const getResponse = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/config", { sessionToken: "tok" }),
      env,
    );
    expect(getResponse?.status).toBe(401);

    const putResponse = await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", { body: "{}", origin: ORIGIN, sessionToken: "tok" }),
      env,
    );
    expect(putResponse?.status).toBe(401);
  });

  test("rejects a PUT with mismatched Origin", async () => {
    mockSessionUser = { id: "user-A" };
    installMockFetch();
    const env = makeEnv();
    const putBody = JSON.stringify({ config: {}, updatedAt: "2026-08-17T12:00:00.000Z" });
    const putResponse = await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", { body: putBody, origin: "https://evil.example.com", sessionToken: "tok" }),
      env,
    );
    expect(putResponse?.status).toBe(403);
  });

  test("rejects an invalid payload shape", async () => {
    mockSessionUser = { id: "user-A" };
    installMockFetch();
    const env = makeEnv();

    const putResponse = await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", {
        body: JSON.stringify({ notConfig: true }),
        origin: ORIGIN,
        sessionToken: "tok",
      }),
      env,
    );
    expect(putResponse?.status).toBe(400);

    const putResponse2 = await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", {
        body: JSON.stringify({ config: "not-an-object", updatedAt: "2026-08-17T12:00:00.000Z" }),
        origin: ORIGIN,
        sessionToken: "tok",
      }),
      env,
    );
    expect(putResponse2?.status).toBe(400);
  });

  test("rejects an oversized body", async () => {
    mockSessionUser = { id: "user-A" };
    installMockFetch();
    const env = makeEnv();
    const huge = "x".repeat(513_000);
    const putResponse = await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", {
        body: JSON.stringify({ config: { padding: huge }, updatedAt: "2026-08-17T12:00:00.000Z" }),
        origin: ORIGIN,
        sessionToken: "tok",
      }),
      env,
    );
    expect(putResponse?.status).toBe(413);
  });
});
