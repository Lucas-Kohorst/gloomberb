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

  test("allows public HTTP fetches without waiting for Gloom Cloud auth", async () => {
    let fetchedUrl = "";
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      fetchedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const response = await workerModule.default.fetch?.(
      makeRequest("POST", "/_gloomberb/rpc", {
        body: JSON.stringify({
          method: "http.fetch",
          payload: {
            url: "https://api.llm-stats.com/v1/models",
            init: { method: "GET", timeoutMs: 1000 },
          },
        }),
      }),
      makeEnv(),
    );

    expect(response?.status).toBe(200);
    expect(fetchedUrl).toBe("https://api.llm-stats.com/v1/models");
    expect((await response?.json()).ok).toBe(true);
  });
});

describe("hosted share Worker endpoint", () => {
  afterEach(() => {
    SNAPSHOTS.clear();
    mockSessionUser = null;
    restoreFetch();
  });

  test("creates an anonymous article share with a short id", async () => {
    mockSessionUser = null;
    installMockFetch();
    const env = makeEnv();
    const response = await workerModule.default.fetch?.(
      makeRequest("POST", "/api/share", {
        origin: ORIGIN,
        body: JSON.stringify({
          kind: "article",
          data: {
            type: "news",
            id: "changelog:hosted-v0-11-0",
            title: "Web terminal",
            url: "",
            source: "Gloomberb Changelog",
            summary: "One release note.",
          },
        }),
      }),
      env,
    );
    expect(response?.status).toBe(200);
    const body = await response?.json() as { id: string };
    expect(body.id).toMatch(/^[A-Za-z0-9]{12}$/);

    const getResponse = await workerModule.default.fetch?.(
      makeRequest("GET", `/api/share/${body.id}`),
      env,
    );
    expect(getResponse?.status).toBe(200);
    const envelope = await getResponse?.json() as { kind: string; data: { id: string } };
    expect(envelope.kind).toBe("article");
    expect(envelope.data.id).toBe("changelog:hosted-v0-11-0");
  });

  test("rejects anonymous chart share creation", async () => {
    mockSessionUser = null;
    installMockFetch();
    const response = await workerModule.default.fetch?.(
      makeRequest("POST", "/api/share", {
        origin: ORIGIN,
        body: JSON.stringify({
          kind: "chart",
          data: { title: "SPY", panels: [], series: [], capturedAt: "2026-08-17T00:00:00.000Z" },
        }),
      }),
      makeEnv(),
    );
    expect(response?.status).toBe(401);
  });

  test("creates an authenticated chart share with a short id", async () => {
    mockSessionUser = { id: "user-A" };
    installMockFetch();
    const env = makeEnv();
    const response = await workerModule.default.fetch?.(
      makeRequest("POST", "/api/share", {
        origin: ORIGIN,
        sessionToken: "tok",
        body: JSON.stringify({
          kind: "chart",
          data: { title: "SPY", panels: [], series: [], capturedAt: "2026-08-17T00:00:00.000Z" },
        }),
      }),
      env,
    );
    expect(response?.status).toBe(200);
    const body = await response?.json() as { id: string };
    expect(body.id).toHaveLength(12);
  });
});

interface CapturedUpstream {
  url: string;
  method: string;
  headers: Headers;
}

/**
 * Records every upstream call the Worker makes and lets a test decide the
 * response. Normalizes string-URL and Request-object fetch inputs so both the
 * REST (`gloomFetch`) and WebSocket (`new Request(...)`) paths are captured.
 */
function installUpstreamCapture(
  respond: (req: CapturedUpstream) => Response,
): CapturedUpstream[] {
  const captured: CapturedUpstream[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = typeof input === "string" || input instanceof URL
      ? new Request(input, init)
      : input;
    const entry: CapturedUpstream = {
      url: request.url,
      method: request.method,
      headers: request.headers,
    };
    captured.push(entry);
    return respond(entry);
  }) as typeof globalThis.fetch;
  return captured;
}

function makeWebSocketRequest(
  options: { origin?: string; sessionToken?: string | null } = {},
): Request {
  const headers = new Headers();
  headers.set("Upgrade", "websocket");
  headers.set("Connection", "Upgrade");
  headers.set("Sec-WebSocket-Version", "13");
  headers.set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==");
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  if (options.sessionToken) headers.set("Cookie", `${SESSION_COOKIE}=${options.sessionToken}`);
  return new Request(`${ORIGIN}/cloud/ws`, { method: "GET", headers });
}

describe("hosted Gloom Cloud proxy origin gate", () => {
  afterEach(() => {
    restoreFetch();
  });

  test("allows a same-origin GET that omits the Origin header", async () => {
    // Browsers do not send an Origin header on same-origin GETs; the chat
    // message/channel/state loads are exactly this shape, so they must proxy.
    const captured = installUpstreamCapture(() => new Response(JSON.stringify([{ id: "everyone" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/cloud/chat/channels", { sessionToken: "real-upstream-token" }),
      makeEnv(),
    );

    expect(response?.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("https://api.gloom.sh/chat/channels");
    // The Worker swaps the opaque hosted cookie for the real upstream session.
    const cookie = captured[0]!.headers.get("Cookie") ?? "";
    expect(cookie).toContain("__Secure-gloomberb.session_token=real-upstream-token");
    expect(cookie).not.toContain("__Host-gloom.session");
  });

  test("rejects a cross-origin GET", async () => {
    installUpstreamCapture(() => new Response("should-not-run", { status: 200 }));
    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/cloud/chat/channels", {
        origin: "https://evil.example.com",
        sessionToken: "real-upstream-token",
      }),
      makeEnv(),
    );
    expect(response?.status).toBe(403);
  });

  test("rejects a write that omits the Origin header", async () => {
    installUpstreamCapture(() => new Response("should-not-run", { status: 200 }));
    const response = await workerModule.default.fetch?.(
      makeRequest("POST", "/cloud/chat/channels/everyone/messages", {
        body: JSON.stringify({ content: "hi" }),
        sessionToken: "real-upstream-token",
      }),
      makeEnv(),
    );
    expect(response?.status).toBe(403);
  });

  test("allows a same-origin write with a matching Origin", async () => {
    const captured = installUpstreamCapture(() => new Response(JSON.stringify({ id: "m1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await workerModule.default.fetch?.(
      makeRequest("POST", "/cloud/chat/channels/everyone/messages", {
        origin: ORIGIN,
        body: JSON.stringify({ content: "hi" }),
        sessionToken: "real-upstream-token",
      }),
      makeEnv(),
    );
    expect(response?.status).toBe(200);
    expect(captured[0]!.url).toBe("https://api.gloom.sh/chat/channels/everyone/messages");
  });

  test("strips the raw upstream token from a rotating response body", async () => {
    // Sign-in rotates the session and echoes the raw token in its body; the
    // hosted client must never receive it (it authenticates via the cookie).
    installUpstreamCapture(() => new Response(
      JSON.stringify({ token: "raw-upstream-token", user: { id: "user-A" } }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "__Secure-gloomberb.session_token=raw-upstream-token; Path=/; HttpOnly",
        },
      },
    ));

    const response = await workerModule.default.fetch?.(
      makeRequest("POST", "/cloud/auth/sign-in/email", {
        origin: ORIGIN,
        body: JSON.stringify({ email: "a@example.com", password: "pw" }),
      }),
      makeEnv(),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-gloom-hosted-session")).toBe("1");
    const body = await response?.json() as { token?: string; user?: { id: string } };
    expect(body.token).toBeUndefined();
    expect(body.user?.id).toBe("user-A");
  });
});

describe("hosted Gloom Cloud WebSocket proxy", () => {
  afterEach(() => {
    restoreFetch();
  });

  test("rejects an unauthenticated upgrade", async () => {
    installUpstreamCapture(() => new Response(null, { status: 500 }));
    const response = await workerModule.default.fetch?.(
      makeWebSocketRequest({ origin: ORIGIN }),
      makeEnv(),
    );
    expect(response?.status).toBe(401);
  });

  test("rejects a cross-origin upgrade", async () => {
    installUpstreamCapture(() => new Response(null, { status: 500 }));
    const response = await workerModule.default.fetch?.(
      makeWebSocketRequest({ origin: "https://evil.example.com", sessionToken: "real-upstream-token" }),
      makeEnv(),
    );
    expect(response?.status).toBe(403);
  });

  test("relays an authenticated upgrade to Gloom Cloud with the server-held session", async () => {
    const captured = installUpstreamCapture(() => (
      { status: 101, webSocket: {} } as unknown as Response
    ));

    const response = await workerModule.default.fetch?.(
      makeWebSocketRequest({ origin: ORIGIN, sessionToken: "real-upstream-token" }),
      makeEnv(),
    );

    expect(response?.status).toBe(101);
    expect(captured).toHaveLength(1);
    const upstream = captured[0]!;
    expect(upstream.url).toBe("https://api.gloom.sh/cloud/ws");
    expect(upstream.headers.get("Upgrade")).toBe("websocket");
    expect(upstream.headers.get("Origin")).toBe("https://api.gloom.sh");
    const cookie = upstream.headers.get("Cookie") ?? "";
    expect(cookie).toContain("__Secure-gloomberb.session_token=real-upstream-token");
    expect(cookie).toContain("gloomberb.session_token=real-upstream-token");
    // The browser-facing hosted cookie must not leak to the upstream socket.
    expect(cookie).not.toContain("__Host-gloom.session");
  });
});
