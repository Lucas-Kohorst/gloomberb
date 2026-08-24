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
    const marketId = "polymarket:0x80b3af88cb9919808da1ce86b9794a0957f96ec98c29319dd7ba65e9744d82b1";
    const similar = await adjacentProvider.resolve({
      keyPath: `markets/${marketId}/similar`,
      search: new URLSearchParams(),
    });
    expect(similar.kind).toBe("proxy");
    if (similar.kind !== "proxy") throw new Error("expected proxy plan");
    expect(similar.url).toBe(
      `https://api.adjacent.markets/api/v1/markets/${marketId}/similar`,
    );

    const news = await adjacentProvider.resolve({
      keyPath: "markets/kalshi:KXPRESPARTY-2028-D/news",
      search: new URLSearchParams("?per_page=3"),
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
});
