import { afterEach, describe, expect, test } from "bun:test";
import type { AdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentMarket } from "../../builtin/adjacent/types";
import {
  adjacentMarketCandidateIds,
  adjacentMarketSearchQueries,
  preloadAdjacentMarketExtras,
  resetAdjacentMarketMatchCache,
  resolveAdjacentMarketId,
  simplifiedTitleQuery,
} from "./adjacent-match";

afterEach(() => {
  resetAdjacentMarketMatchCache();
});

function market(id: string, title = "Will something happen?"): AdjacentMarket {
  const platform = id.startsWith("polymarket:") ? "polymarket" : "kalshi";
  return {
    id,
    platform,
    title,
    status: "active",
    yes_price: 50,
    no_price: 50,
  };
}

function fakeClient(options: {
  get?: Record<string, AdjacentMarket | Error>;
  find?: Record<string, string[]>;
  search?: Record<string, AdjacentMarket[]>;
}): AdjacentClient & { calls: string[] } {
  const calls: string[] = [];
  const client = {
    calls,
    async getMarket(id: string) {
      calls.push(`get:${id}`);
      const result = options.get?.[id];
      if (result instanceof Error) throw result;
      if (result) return result;
      throw new Error(`Adjacent request failed (404) for ${id}`);
    },
    async searchMarketsByText(query: string) {
      calls.push(`find:${query}`);
      return options.find?.[query] ?? [];
    },
    async searchMarkets(query: string) {
      calls.push(`search:${query}`);
      return { markets: options.search?.[query] ?? [] };
    },
  };
  return client as unknown as AdjacentClient & { calls: string[] };
}

describe("adjacent market id matching", () => {
  test("builds platform:raw ids from Kalshi ticker and event, not the title", () => {
    expect(
      adjacentMarketCandidateIds({
        venue: "kalshi",
        marketId: "KXHIGHLAX-26AUG19-B82.5",
        eventTicker: "KXHIGHLAX-26AUG19",
        seriesTicker: "KXHIGHLAX",
        title: "Will the high temperature in Los Angeles be above 82.5°F on Aug 19, 2026?",
      }),
    ).toEqual([
      "kalshi:KXHIGHLAX-26AUG19-B82.5",
      "kalshi:KXHIGHLAX-26AUG19",
    ]);
  });

  test("builds platform:raw ids from Polymarket market id, event, and slug", () => {
    expect(
      adjacentMarketCandidateIds({
        venue: "polymarket",
        marketId: "12345",
        eventId: "67890",
        conditionId: "0xabc",
        url: "https://polymarket.com/event/btc-100k",
        title: "Will Bitcoin be above $100,000?",
      }),
    ).toEqual([
      "polymarket:btc-100k",
      "polymarket:0xabc",
      "polymarket:12345",
      "polymarket:67890",
    ]);
  });

  test("resolves via getMarket on platform:raw id and never title-searches", async () => {
    const id = "kalshi:KXHIGHLAX-26AUG19-B82.5";
    const client = fakeClient({
      get: { [id]: market(id) },
    });
    const resolved = await resolveAdjacentMarketId(client, {
      venue: "kalshi",
      marketId: "KXHIGHLAX-26AUG19-B82.5",
      eventTicker: "KXHIGHLAX-26AUG19",
      title: "Will the high temperature in Los Angeles be above 82.5°F on Aug 19, 2026?",
    });
    expect(resolved).toBe(id);
    expect(client.calls[0]).toBe(`get:${id}`);
    expect(client.calls.some((call) => call.startsWith("search:") || call.startsWith("find:"))).toBe(false);
  });

  test("falls back to parent event ticker get, then find by ticker", async () => {
    const client = fakeClient({
      get: {
        "kalshi:KXHIGHLAX-26AUG19-B82.5": new Error("404"),
        "kalshi:KXHIGHLAX-26AUG19": market("kalshi:KXHIGHLAX-26AUG19"),
      },
    });
    const resolved = await resolveAdjacentMarketId(client, {
      venue: "kalshi",
      marketId: "KXHIGHLAX-26AUG19-B82.5",
      eventTicker: "KXHIGHLAX-26AUG19",
      title: "Will the high temperature in Los Angeles be above 82.5°F?",
    });
    expect(resolved).toBe("kalshi:KXHIGHLAX-26AUG19");
    expect(client.calls).toEqual([
      "get:kalshi:KXHIGHLAX-26AUG19-B82.5",
      "get:kalshi:KXHIGHLAX-26AUG19",
    ]);
  });

  test("uses find/get ticker search before a shortened title query", async () => {
    const title = "Will Bitcoin be above $100,000 on December 31, 2026 according to CF Benchmarks?";
    const queries = adjacentMarketSearchQueries({
      venue: "polymarket",
      marketId: "0xdead",
      title,
    });
    expect(queries[0]).not.toBe(title);
    expect(queries).toContain("0xdead");
    expect(simplifiedTitleQuery(title)?.split(" ").length).toBeLessThanOrEqual(4);

    const client = fakeClient({
      find: {
        "0xdead": ["polymarket:btc-100k"],
      },
    });
    const resolved = await resolveAdjacentMarketId(client, {
      venue: "polymarket",
      marketId: "0xdead",
      title,
    });
    expect(resolved).toBe("polymarket:btc-100k");
    expect(client.calls[0]).toBe("get:polymarket:0xdead");
    expect(client.calls).toContain("find:0xdead");
    expect(client.calls.some((call) => call.startsWith("search:") && call.includes("Will Bitcoin"))).toBe(false);
  });

  test("resolves Polymarket slug before Gamma numeric ids", async () => {
    const slugId = "polymarket:btc-100k";
    const client = fakeClient({
      get: { [slugId]: market(slugId) },
    });
    const resolved = await resolveAdjacentMarketId(client, {
      venue: "polymarket",
      marketId: "12345",
      eventId: "67890",
      conditionId: "0xabc",
      url: "https://polymarket.com/event/btc-100k",
      title: "Will Bitcoin be above $100,000?",
    });
    expect(resolved).toBe(slugId);
    expect(client.calls[0]).toBe(`get:${slugId}`);
    expect(client.calls).not.toContain("get:polymarket:12345");
  });

  test("preloads similar markets and at least 10 news articles after resolving the id", async () => {
    const matched = market("kalshi:KXTEST-1");
    const similar: string[] = [];
    const news: string[] = [];
    const client = fakeClient({
      get: { [matched.id]: matched },
    });
    (client as unknown as {
      getSimilarMarkets: (id: string) => Promise<{ markets: [] }>;
      getMarketNews: (id: string, params?: { limit?: number }) => Promise<{ news: [] }>;
    }).getSimilarMarkets = async (id: string) => {
      similar.push(id);
      return { markets: [] };
    };
    (client as unknown as {
      getMarketNews: (id: string, params?: { limit?: number }) => Promise<{ news: [] }>;
    }).getMarketNews = async (id: string, params?: { limit?: number }) => {
      news.push(`${id}:${params?.limit ?? 0}`);
      return { news: [] };
    };

    await preloadAdjacentMarketExtras(client, {
      venue: "kalshi",
      marketId: "KXTEST-1",
      title: "Will the Fed cut rates?",
    });

    expect(similar).toEqual(["kalshi:KXTEST-1"]);
    expect(news).toEqual(["kalshi:KXTEST-1:20"]);
  });
});
