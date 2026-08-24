import { describe, expect, test } from "bun:test";
import { adjacentProvider } from "./adjacent";

describe("adjacent provider", () => {
  test("rejects empty and traversal paths", async () => {
    const empty = await adjacentProvider.resolve({ keyPath: "", search: new URLSearchParams() });
    expect(empty.kind).toBe("error");
    expect(empty.status).toBe(400);

    const traversal = await adjacentProvider.resolve({
      keyPath: "public/markets/../foo",
      search: new URLSearchParams(),
    });
    expect(traversal.kind).toBe("error");
    expect(traversal.status).toBe(400);
  });

  test("allows prefixed market IDs in similar and news paths", async () => {
    const env = { ADJACENT_API_KEY: "adj-secret" } as Env;
    const marketId = "polymarket:0x80b3af88cb9919808da1ce86b9794a0957f96ec98c29319dd7ba65e9744d82b1";
    const similar = await adjacentProvider.resolve({
      keyPath: `markets/${marketId}/similar`,
      search: new URLSearchParams(),
      env,
    });
    expect(similar.kind).toBe("proxy");
    if (similar.kind !== "proxy") throw new Error("expected proxy plan");
    expect(similar.url).toBe(
      `https://api.adjacent.markets/api/v1/markets/${marketId}/similar`,
    );

    const news = await adjacentProvider.resolve({
      keyPath: "markets/kalshi:KXPRESPARTY-2028-D/news",
      search: new URLSearchParams("?per_page=3"),
      env,
    });
    expect(news.kind).toBe("proxy");
    if (news.kind !== "proxy") throw new Error("expected proxy plan");
    expect(news.url).toBe(
      "https://api.adjacent.markets/api/v1/markets/kalshi:KXPRESPARTY-2028-D/news?per_page=3",
    );
  });

  test("rejects paths with control characters", async () => {
    const bad = await adjacentProvider.resolve({
      keyPath: "public/markets/foo bar/news",
      search: new URLSearchParams(),
    });
    expect(bad.kind).toBe("error");
    expect(bad.status).toBe(400);
  });

  test("rewrites auth list paths to public when the Worker has no Adjacent key", async () => {
    const env = {} as Env;
    const indices = await adjacentProvider.resolve({
      keyPath: "indices",
      search: new URLSearchParams(),
      env,
    });
    expect(indices.kind).toBe("proxy");
    if (indices.kind !== "proxy") throw new Error("expected proxy plan");
    expect(indices.url).toBe("https://api.adjacent.markets/api/v1/public/indices");

    const nested = await adjacentProvider.resolve({
      keyPath: "indices/red/constituents",
      search: new URLSearchParams(),
      env,
    });
    expect(nested.kind).toBe("proxy");
    if (nested.kind !== "proxy") throw new Error("expected proxy plan");
    expect(nested.url).toBe("https://api.adjacent.markets/api/v1/public/indices/red/constituents");

    const alreadyPublic = await adjacentProvider.resolve({
      keyPath: "public/markets",
      search: new URLSearchParams("limit=5"),
      env,
    });
    expect(alreadyPublic.kind).toBe("proxy");
    if (alreadyPublic.kind !== "proxy") throw new Error("expected proxy plan");
    expect(alreadyPublic.url).toBe("https://api.adjacent.markets/api/v1/public/markets?limit=5");
  });

  test("keeps auth paths when the Worker has an Adjacent key", async () => {
    const env = { ADJACENT_API_KEY: "adj-secret" } as Env;
    const indices = await adjacentProvider.resolve({
      keyPath: "indices",
      search: new URLSearchParams(),
      env,
    });
    expect(indices.kind).toBe("proxy");
    if (indices.kind !== "proxy") throw new Error("expected proxy plan");
    expect(indices.url).toBe("https://api.adjacent.markets/api/v1/indices");
  });

  test("does not invent a public twin for news", async () => {
    const news = await adjacentProvider.resolve({
      keyPath: "news/latest",
      search: new URLSearchParams(),
      env: {} as Env,
    });
    expect(news.kind).toBe("proxy");
    if (news.kind !== "proxy") throw new Error("expected proxy plan");
    expect(news.url).toBe("https://api.adjacent.markets/api/v1/news/latest");
  });
});
