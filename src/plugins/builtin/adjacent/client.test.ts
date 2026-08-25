import { afterEach, describe, expect, test } from "bun:test";
import { AdjacentClient } from "./client";

const HEX_MARKET_ID = "polymarket:0x80b3af88cb9919808da1ce86b9794a0957f96ec98c29319dd7ba65e9744d82b1";

type HostedFlag = { __GLOOM_CLOUD_HOSTED?: boolean };

function setHosted(hosted: boolean): void {
  const flag = globalThis as HostedFlag;
  if (hosted) flag.__GLOOM_CLOUD_HOSTED = true;
  else delete flag.__GLOOM_CLOUD_HOSTED;
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? null;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return null;
}

describe("AdjacentClient paths", () => {
  const originalFetch = globalThis.fetch;
  let requested: Array<{ url: string; authorization: string | null }>;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setHosted(false);
  });

  function mockFetch(body: unknown = { data: [] }): void {
    requested = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      requested.push({
        url,
        authorization: headerValue(init?.headers, "Authorization"),
      });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  }

  test("hosted uses worker auth prefixes even without a browser key", async () => {
    setHosted(true);
    mockFetch();
    const client = new AdjacentClient();

    await client.getSimilarMarkets(HEX_MARKET_ID);
    await client.getLatestNews(20);
    await client.getNews({ limit: 50, offset: 10 });
    await client.getMarketNews(HEX_MARKET_ID);
    await client.searchMarkets("bitcoin", 8, "polymarket");
    await client.getMarketPrices(HEX_MARKET_ID, "1h");

    expect(requested.map((entry) => entry.url)).toEqual([
      `/api/data/adjacent/markets/${HEX_MARKET_ID}/similar`,
      "/api/data/adjacent/news/latest?per_page=20",
      "/api/data/adjacent/news?limit=50&offset=10",
      `/api/data/adjacent/markets/${HEX_MARKET_ID}/news?per_page=20`,
      "/api/data/adjacent/markets?search=bitcoin&per_page=8&page=1&platform=polymarket",
      `/api/data/adjacent/markets/${HEX_MARKET_ID}/prices?interval=1hour`,
    ]);
    expect(requested.every((entry) => !entry.url.includes("/public/"))).toBe(true);
    expect(requested.every((entry) => entry.authorization == null)).toBe(true);
  });

  test("desktop with a user key uses auth prefixes and Bearer", async () => {
    setHosted(false);
    mockFetch();
    const client = new AdjacentClient({ apiKey: "ak_test" });

    await client.getSimilarMarkets("kalshi:KXPRESPARTY-2028-D");
    await client.searchMarkets("senate", 5);
    await client.getMarketNews("kalshi:KXPRESPARTY-2028-D");
    await client.getNews({ limit: 25 });

    expect(requested.map((entry) => entry.url)).toEqual([
      "https://api.adjacent.markets/api/v1/markets/kalshi:KXPRESPARTY-2028-D/similar",
      "https://api.adjacent.markets/api/v1/markets?search=senate&per_page=5&page=1",
      "https://api.adjacent.markets/api/v1/markets/kalshi:KXPRESPARTY-2028-D/news?per_page=20",
      "https://api.adjacent.markets/api/v1/news?limit=25",
    ]);
    expect(requested.every((entry) => entry.authorization === "Bearer ak_test")).toBe(true);
    expect(requested.every((entry) => !entry.url.includes("/public/"))).toBe(true);
  });

  test("desktop without a key keeps public market paths but not public similar or news list", async () => {
    setHosted(false);
    mockFetch();
    const client = new AdjacentClient();

    await client.searchMarkets("bitcoin", 8);
    await client.getSimilarMarkets(HEX_MARKET_ID);
    await client.getLatestNews(15);
    await client.getMarketNews(HEX_MARKET_ID);

    expect(requested[0]?.url).toBe(
      "https://api.adjacent.markets/api/v1/public/markets?search=bitcoin&per_page=8&page=1&scope=all",
    );
    expect(requested[1]?.url).toBe(
      `https://api.adjacent.markets/api/v1/markets/${HEX_MARKET_ID}/similar`,
    );
    expect(requested[2]?.url).toBe("https://api.adjacent.markets/api/v1/news/latest?per_page=15");
    expect(requested[3]?.url).toBe(
      `https://api.adjacent.markets/api/v1/public/markets/${HEX_MARKET_ID}/news?per_page=20`,
    );
    expect(requested.some((entry) => /q=/.test(entry.url))).toBe(false);
    expect(requested.some((entry) => entry.url.includes("public/markets/") && entry.url.endsWith("/similar"))).toBe(false);
  });

  test("concurrent getMarketNews shares one in-flight request", async () => {
    setHosted(false);
    requested = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      requested.push({
        url,
        authorization: headerValue(init?.headers, "Authorization"),
      });
      await Bun.sleep(15);
      return new Response(JSON.stringify({ news: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = new AdjacentClient({ apiKey: "ak_test" });
    await Promise.all([
      client.getMarketNews("kalshi:KXTEST-1"),
      client.getMarketNews("kalshi:KXTEST-1", { limit: 20 }),
    ]);
    expect(requested).toHaveLength(1);
    expect(requested[0]?.url).toBe(
      "https://api.adjacent.markets/api/v1/markets/kalshi:KXTEST-1/news?per_page=20",
    );
  });

  test("unwraps similar { data } payloads for the UI", async () => {
    setHosted(false);
    mockFetch({
      data: [{
        market_id: "kalshi:KXNBA-26-NYK",
        question: "Will the New York win the 2026 Pro Basketball Finals?",
        latest_price: 37,
        similarity: 0.91,
        platform: "kalshi",
      }],
    });
    const client = new AdjacentClient({ apiKey: "ak_test" });
    const response = await client.getSimilarMarkets("kalshi:KXNBA-26-BOS");
    expect(response.markets?.[0]).toMatchObject({
      id: "kalshi:KXNBA-26-NYK",
      platform: "kalshi",
      title: "Will the New York win the 2026 Pro Basketball Finals?",
      yes_price: 37,
      similarity: 0.91,
    });
  });
});
