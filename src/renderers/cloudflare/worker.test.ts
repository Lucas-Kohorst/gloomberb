import { afterEach, describe, expect, test } from "bun:test";
import { resetKeyedDataCache } from "./data-providers/handle";

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

  test("stores tickers and notes beside the config without dropping them on a config-only PUT", async () => {
    mockSessionUser = { id: "user-A" };
    installMockFetch();
    const env = makeEnv();
    const first = JSON.stringify({
      config: { theme: "amber" },
      updatedAt: "2026-08-20T12:00:00.000Z",
      tickers: [{ ticker: "ETH-USD", portfolios: ["main"] }],
      notes: { tickerNotes: { "ETH-USD": "watch the merge" }, quickNotes: {}, quickNotesIndex: [] },
    });
    expect((await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", { body: first, origin: ORIGIN, sessionToken: "tok" }),
      env,
    ))?.status).toBe(200);

    const configOnly = JSON.stringify({
      config: { theme: "default" },
      updatedAt: "2026-08-20T13:00:00.000Z",
    });
    await workerModule.default.fetch?.(
      makeRequest("PUT", "/api/config", { body: configOnly, origin: ORIGIN, sessionToken: "tok" }),
      env,
    );

    const getResponse = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/config", { sessionToken: "tok" }),
      env,
    );
    const body = await getResponse?.json() as {
      config: { theme: string };
      tickers: unknown;
      notes: { tickerNotes: Record<string, string> };
    };
    expect(body.config.theme).toBe("default");
    expect(body.tickers).toEqual([{ ticker: "ETH-USD", portfolios: ["main"] }]);
    expect(body.notes.tickerNotes["ETH-USD"]).toBe("watch the merge");
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

describe("Adjacent Cloud keyed-data providers", () => {
  afterEach(() => {
    resetKeyedDataCache();
    restoreFetch();
  });

  test("lists registered providers without one-off routes", async () => {
    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data"),
      makeEnv(),
    );
    expect(response?.status).toBe(200);
    const body = await response?.json() as { providers: Array<{ id: string }> };
    expect(body.providers.map((provider) => provider.id).sort()).toEqual([
      "adjacent",
      "llm-stats",
      "nws-cli",
      "owid",
      "twc-kalshi",
      "us-listings",
      "votehub",
    ]);
  });

  test("TWC alias allowlists kalshi/api and rejects other weather.com paths", async () => {
    let fetchedUrl = "";
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      fetchedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response("{\"ok\":true}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const ok = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/weather/twc/kalshi/api/climate/primary?date=2026-08-18"),
      makeEnv(),
    );
    expect(ok?.status).toBe(200);
    expect(fetchedUrl).toBe("https://weather.com/kalshi/api/climate/primary?date=2026-08-18");
    expect(ok?.headers.get("cache-control")).toContain("max-age=60");

    const blocked = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/weather/twc/v3/wx/observations"),
      makeEnv(),
    );
    expect(blocked?.status).toBe(404);
  });

  test("NWS CLI provider returns a first-final print keyed by ICAO", async () => {
    const cliText = `CLINYC

CLIMATE REPORT
...THE CENTRAL PARK NY CLIMATE SUMMARY FOR AUGUST 18 2026...
TEMPERATURE (F)
 YESTERDAY
  MAXIMUM         87
  MINIMUM         70
PRECIPITATION (IN)
  YESTERDAY        0.00
`;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/stations/KNYC")) {
        return Response.json({ geometry: { coordinates: [-73.96, 40.77] } });
      }
      if (url.includes("/points/")) {
        return Response.json({ properties: { cwa: "OKX" } });
      }
      if (url.includes("/products/types/CLI/locations/OKX")) {
        return Response.json({
          "@graph": [{ id: "final", "@id": "https://api.weather.gov/products/final", issuanceTime: "2026-08-19T05:32:00Z" }],
        });
      }
      if (url.endsWith("/products/final")) {
        return Response.json({ issuanceTime: "2026-08-19T05:32:00Z", productText: cliText });
      }
      return new Response("missing", { status: 404 });
    }) as typeof globalThis.fetch;

    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/nws-cli/KNYC"),
      makeEnv(),
    );
    expect(response?.status).toBe(200);
    const body = await response?.json() as { icao: string; highF: number; printKind: string };
    expect(body.icao).toBe("KNYC");
    expect(body.highF).toBe(87);
    expect(body.printKind).toBe("final");
  });

  test("llm-stats and Adjacent share GET /api/data", async () => {
    let fetchedUrl = "";
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      fetchedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }) as typeof globalThis.fetch;

    const llm = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/llm-stats/v1/models"),
      makeEnv(),
    );
    expect(llm?.status).toBe(200);
    expect(fetchedUrl).toBe("https://api.llm-stats.com/v1/models");

    const adjacent = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/adjacent/public/markets?limit=5"),
      makeEnv(),
    );
    expect(adjacent?.status).toBe(200);
    expect(fetchedUrl).toBe("https://api.adjacent.markets/api/v1/public/markets?limit=5");

    const unknown = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/jina-ai/read?url=https://example.com/story"),
      makeEnv(),
    );
    expect(unknown?.status).toBe(404);

    const badAdjacent = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/adjacent/http://evil.example"),
      makeEnv(),
    );
    expect(badAdjacent?.status).toBe(400);
  });

  test("VoteHub polls are cached on the Worker for 15 minutes", async () => {
    let upstreamHits = 0;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      upstreamHits += 1;
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://api.votehub.com/polls?poll_type=approval");
      return Response.json([{ id: "p1", pollster: "Ipsos", subject: "Donald Trump" }]);
    }) as typeof globalThis.fetch;

    const first = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/votehub/polls?poll_type=approval&callback=evil"),
      makeEnv(),
    );
    const second = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/votehub/polls?poll_type=approval"),
      makeEnv(),
    );
    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    expect(first?.headers.get("cache-control")).toContain("max-age=900");
    expect(upstreamHits).toBe(1);
    expect(await first?.json()).toEqual([{ id: "p1", pollster: "Ipsos", subject: "Donald Trump" }]);

    const blocked = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/votehub/secret"),
      makeEnv(),
    );
    expect(blocked?.status).toBe(404);
  });

  test("US listings master caches Nasdaq/NYSE files for 12 hours", async () => {
    let nasdaqHits = 0;
    let otherHits = 0;
    let secHits = 0;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("nasdaqlisted.txt")) {
        nasdaqHits += 1;
        return new Response(`Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
`, { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url.includes("otherlisted.txt")) {
        otherHits += 1;
        return new Response(`ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
IBM|International Business Machines Corporation Common Stock|N|IBM|N|100|N|IBM
`, { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url.includes("company_tickers_exchange.json")) {
        secHits += 1;
        return Response.json({
          fields: ["cik", "name", "ticker", "exchange"],
          data: [[1, "Pink Example", "EXMPL", "OTC"]],
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof globalThis.fetch;

    const first = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/us-listings/universe"),
      makeEnv(),
    );
    const second = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/us-listings/universe"),
      makeEnv(),
    );
    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    expect(first?.headers.get("cache-control")).toContain("max-age=43200");
    expect(nasdaqHits).toBe(1);
    expect(otherHits).toBe(1);
    expect(secHits).toBe(1);

    const body = await first?.json() as {
      ttlSeconds: number;
      securities: Array<{ s: string; e: string; src: string }>;
    };
    expect(body.ttlSeconds).toBe(43200);
    expect(body.securities).toEqual(expect.arrayContaining([
      expect.objectContaining({ s: "AAPL", e: "NASDAQ", src: "nasdaqlisted" }),
      expect.objectContaining({ s: "IBM", e: "NYSE", src: "otherlisted" }),
      expect.objectContaining({ s: "EXMPL", e: "OTC", src: "sec-otc" }),
    ]));

    const blocked = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/us-listings/secret"),
      makeEnv(),
    );
    expect(blocked?.status).toBe(404);
  });

  test("OWID caches grapher CSV+metadata and allowlists slug/entity paths", async () => {
    let csvHits = 0;
    let metaHits = 0;
    let searchHits = 0;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/search?")) {
        searchHits += 1;
        return Response.json({
          nbHits: 1,
          results: [{ title: "Life expectancy", slug: "life-expectancy", availableEntities: ["United States"] }],
        });
      }
      if (url.includes("life-expectancy.csv")) {
        csvHits += 1;
        return new Response("Entity,Code,Year,Life expectancy\nUnited States,USA,2020,77.28\n", {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      }
      if (url.endsWith("life-expectancy.metadata.json")) {
        metaHits += 1;
        return Response.json({ chart: { title: "Life expectancy", citation: "UN WPP" }, columns: {} });
      }
      if (url.includes("secret-chart.csv") || url.includes("secret-chart.metadata.json")) {
        return Response.json({ error: "Non-redistributable data" }, { status: 403 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof globalThis.fetch;

    const search = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/charts?q=life&callback=evil"),
      makeEnv(),
    );
    const searchAgain = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/charts?q=life"),
      makeEnv(),
    );
    expect(search?.status).toBe(200);
    expect(searchAgain?.status).toBe(200);
    expect(searchHits).toBe(1);

    const first = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/life-expectancy/USA"),
      makeEnv(),
    );
    const second = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/life-expectancy/USA"),
      makeEnv(),
    );
    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    expect(first?.headers.get("cache-control")).toContain("max-age=21600");
    expect(csvHits).toBe(1);
    expect(metaHits).toBe(1);
    const body = await first?.json() as { slug: string; entity: { code: string }; license: string };
    expect(body.slug).toBe("life-expectancy");
    expect(body.entity.code).toBe("USA");
    expect(body.license).toBe("CC BY 4.0");

    const blockedPath = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/../secret"),
      makeEnv(),
    );
    expect(blockedPath?.status).toBe(404);

    const nonRedistributable = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/secret-chart"),
      makeEnv(),
    );
    expect(nonRedistributable?.status).toBe(403);
    const errorBody = await nonRedistributable?.json() as { error: string };
    expect(errorBody.error).toContain("non-redistributable");

    metaHits = 0;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("life-expectancy.metadata.json")) {
        metaHits += 1;
        return Response.json({ chart: { title: "Life expectancy", citation: "UN WPP" }, columns: {} });
      }
      if (url.includes("secret-chart.metadata.json")) {
        return Response.json({ error: "Non-redistributable data" }, { status: 403 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof globalThis.fetch;

    const meta = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/meta/life-expectancy"),
      makeEnv(),
    );
    const metaAgain = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/meta/life-expectancy"),
      makeEnv(),
    );
    expect(meta?.status).toBe(200);
    expect(metaAgain?.status).toBe(200);
    expect(metaHits).toBe(1);
    const metaBody = await meta?.json() as { slug: string; license: string };
    expect(metaBody.slug).toBe("life-expectancy");
    expect(metaBody.license).toBe("CC BY 4.0");

    const blockedMeta = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/meta/secret-chart"),
      makeEnv(),
    );
    const blockedMetaAgain = await workerModule.default.fetch?.(
      makeRequest("GET", "/api/data/owid/meta/secret-chart"),
      makeEnv(),
    );
    expect(blockedMeta?.status).toBe(403);
    expect(blockedMetaAgain?.status).toBe(403);
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

describe("Gloom Cloud /cloud origin gate", () => {
  afterEach(() => {
    restoreFetch();
  });

  test("GET without Origin reaches auth instead of Invalid origin", async () => {
    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/cloud/sync/snapshot"),
      makeEnv(),
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "Authentication required." });
  });

  test("allows terminal.kohor.st Origin on the workers.dev host", async () => {
    const headers = new Headers();
    headers.set("Origin", ORIGIN);
    const request = new Request("https://gloomberb-cloud.kohorstlucas.workers.dev/cloud/sync/snapshot", {
      method: "GET",
      headers,
    });
    const response = await workerModule.default.fetch?.(request, makeEnv());
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "Authentication required." });
    expect(response?.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  test("rejects api.gloom.sh as a browser Origin", async () => {
    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/cloud/sync/snapshot", { origin: "https://api.gloom.sh" }),
      makeEnv(),
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Invalid origin" });
  });

  test("rejects a PUT with no Origin", async () => {
    const response = await workerModule.default.fetch?.(
      makeRequest("PUT", "/cloud/sync/snapshot", { body: "{}" }),
      makeEnv(),
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Invalid origin" });
  });

  test("GET /cloud/econ/calendar with a session proxies to api.gloom.sh/cloud/econ/calendar", async () => {
    const upstream: string[] = [];
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      upstream.push(url);
      if (url === "https://api.gloom.sh/cloud/econ/calendar") {
        return Response.json([{
          id: "cpi",
          date: "2026-08-20T12:30:00.000Z",
          time: "08:30",
          country: "US",
          event: "CPI",
          actual: null,
          forecast: null,
          prior: null,
          impact: "high",
        }]);
      }
      return new Response("not found", { status: 404 });
    }) as typeof globalThis.fetch;

    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/cloud/econ/calendar", { origin: ORIGIN, sessionToken: "tok" }),
      makeEnv(),
    );
    expect(response?.status).toBe(200);
    expect(upstream).toContain("https://api.gloom.sh/cloud/econ/calendar");
    expect(upstream.some((url) => url === "https://api.gloom.sh/econ/calendar")).toBe(false);
  });

  test("GET /cloud/cloud/econ/calendar with a session also reaches the Cloud calendar", async () => {
    const upstream: string[] = [];
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      upstream.push(url);
      if (url === "https://api.gloom.sh/cloud/econ/calendar") {
        return Response.json([]);
      }
      return new Response("not found", { status: 404 });
    }) as typeof globalThis.fetch;

    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/cloud/cloud/econ/calendar", { origin: ORIGIN, sessionToken: "tok" }),
      makeEnv(),
    );
    expect(response?.status).toBe(200);
    expect(upstream).toContain("https://api.gloom.sh/cloud/econ/calendar");
  });

  test("GET /cloud/econ/calendar without a session is 401, not an empty calendar", async () => {
    const response = await workerModule.default.fetch?.(
      makeRequest("GET", "/cloud/econ/calendar", { origin: ORIGIN }),
      makeEnv(),
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "Authentication required." });
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

describe("share document serving", () => {
  test("GET /s/{id} fetches /share.html without Cookie or If-None-Match", async () => {
    const captured: Request[] = [];
    const env = makeEnv();
    env.ASSETS = {
      fetch: async (request: RequestInfo) => {
        captured.push(request instanceof Request ? request : new Request(request));
        return new Response("<html>share</html>", {
          headers: { "content-type": "text/html", etag: '"share-html"' },
        });
      },
    } as unknown as Fetcher;

    const headers = new Headers();
    headers.set("Cookie", `${SESSION_COOKIE}=logged-in`);
    headers.set("If-None-Match", '"index-html-etag"');
    headers.set("Accept", "text/html");
    const response = await workerModule.default.fetch?.(
      new Request(`${ORIGIN}/s/SdIc3WRwjojR`, { method: "GET", headers }),
      env,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toContain("no-store");
    expect(captured).toHaveLength(1);
    const asset = captured[0]!;
    expect(new URL(asset.url).pathname).toBe("/share.html");
    expect(asset.headers.get("Cookie")).toBeNull();
    expect(asset.headers.get("If-None-Match")).toBeNull();
  });

  test("GET hashed share-main.js does not forward Cookie or If-None-Match", async () => {
    const captured: Request[] = [];
    const env = makeEnv();
    env.ASSETS = {
      fetch: async (request: RequestInfo) => {
        captured.push(request instanceof Request ? request : new Request(request));
        return new Response("export {}", {
          headers: { "content-type": "text/javascript", etag: '"old-share-main"' },
        });
      },
    } as unknown as Fetcher;

    const headers = new Headers();
    headers.set("Cookie", `${SESSION_COOKIE}=logged-in`);
    headers.set("If-None-Match", '"old-share-main"');
    headers.set("Accept", "*/*");
    const response = await workerModule.default.fetch?.(
      new Request(`${ORIGIN}/share-main.a1b2c3d4e5.js`, { method: "GET", headers }),
      env,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toContain("no-store");
    expect(captured).toHaveLength(1);
    const asset = captured[0]!;
    expect(new URL(asset.url).pathname).toBe("/share-main.a1b2c3d4e5.js");
    expect(asset.headers.get("Cookie")).toBeNull();
    expect(asset.headers.get("If-None-Match")).toBeNull();
  });

  test("GET /s/{id} never 304s a cached SPA body for a logged-in browser", async () => {
    const env = makeEnv();
    env.ASSETS = {
      fetch: async () => new Response("<html>share</html>", {
        status: 304,
        headers: { etag: '"index-html-etag"', "content-type": "text/html" },
      }),
    } as unknown as Fetcher;

    const headers = new Headers();
    headers.set("Cookie", `${SESSION_COOKIE}=logged-in`);
    headers.set("If-None-Match", '"index-html-etag"');
    const response = await workerModule.default.fetch?.(
      new Request(`${ORIGIN}/s/cqT4HwQPu8J2`, { method: "GET", headers }),
      env,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("etag")).toBeNull();
    expect(response?.headers.get("cache-control")).toContain("no-store");
  });

  test("GET /web-main.js with Accept-Encoding br serves the precompressed .br file", async () => {
    const captured: Request[] = [];
    const env = makeEnv();
    env.ASSETS = {
      fetch: async (request: RequestInfo) => {
        captured.push(request instanceof Request ? request : new Request(request));
        const url = new URL(request instanceof Request ? request.url : String(request));
        if (url.pathname === "/web-main.js.br") {
          return new Response("brotli-bytes", { headers: { "content-type": "text/javascript" } });
        }
        return new Response("original-bytes", { headers: { "content-type": "text/javascript", etag: '"original"' } });
      },
    } as unknown as Fetcher;

    const headers = new Headers();
    headers.set("Accept-Encoding", "br, gzip");
    const response = await workerModule.default.fetch?.(
      new Request(`${ORIGIN}/web-main.js`, { method: "GET", headers }),
      env,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Encoding")).toBe("br");
    expect(response?.headers.get("Vary")).toBe("Accept-Encoding");
    expect(captured).toHaveLength(1);
    expect(new URL(captured[0]!.url).pathname).toBe("/web-main.js.br");
  });

  test("GET /web-main.js falls back to gzip when Brotli is unavailable", async () => {
    const captured: Request[] = [];
    const env = makeEnv();
    env.ASSETS = {
      fetch: async (request: RequestInfo) => {
        captured.push(request instanceof Request ? request : new Request(request));
        const url = new URL(request instanceof Request ? request.url : String(request));
        if (url.pathname === "/web-main.js.gz") {
          return new Response("gzip-bytes", { headers: { "content-type": "text/javascript" } });
        }
        return new Response("original-bytes", { headers: { "content-type": "text/javascript" } });
      },
    } as unknown as Fetcher;

    const headers = new Headers();
    headers.set("Accept-Encoding", "gzip");
    const response = await workerModule.default.fetch?.(
      new Request(`${ORIGIN}/web-main.js`, { method: "GET", headers }),
      env,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Encoding")).toBe("gzip");
    expect(new URL(captured[0]!.url).pathname).toBe("/web-main.js.gz");
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
