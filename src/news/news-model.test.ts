import { describe, expect, it } from "bun:test";
import { dedupeNewsArticles, filterNewsArticlesForQuery, TOP_NEWS_WINDOW_MS } from "./news-model";
import type { NewsArticle } from "./types";

function makeArticle(overrides: Partial<NewsArticle> & { url: string }): NewsArticle {
  return {
    id: overrides.id ?? overrides.url,
    title: overrides.title ?? "Test headline",
    url: overrides.url,
    guid: overrides.guid,
    source: overrides.source ?? "Test",
    publishedAt: overrides.publishedAt ?? new Date("2025-01-01T12:00:00Z"),
    topic: overrides.topic ?? "general",
    topics: overrides.topics ?? [overrides.topic ?? "general"],
    sectors: overrides.sectors ?? [],
    categories: overrides.categories ?? [],
    tickers: overrides.tickers ?? [],
    scores: overrides.scores ?? {
      importance: overrides.importance ?? 50,
      urgency: 0,
      marketImpact: 0,
      novelty: 0,
      confidence: 0,
    },
    isBreaking: overrides.isBreaking ?? false,
    isDeveloping: overrides.isDeveloping ?? false,
    importance: overrides.importance ?? 50,
    origin: overrides.origin,
  };
}

describe("dedupeNewsArticles identity", () => {
  it("collapses the same RSS guid after a permalink slug change", () => {
    const original = makeArticle({
      id: "hash-old",
      guid: "https://www.fastcompany.com/91595567/lego-has-launched-330-new-products",
      url: "https://www.fastcompany.com/91595567/lego-has-launched-330-new-products",
      title: "Lego has launched 330 new products",
      source: "Fast Company",
      publishedAt: new Date("2026-08-25T13:04:00.000Z"),
      importance: 62,
    });
    const republished = makeArticle({
      id: "hash-new",
      guid: "https://www.fastcompany.com/91595567/lego-has-launched-330-new-products",
      url: "https://www.fastcompany.com/91595567/lego-has-released-330-new-products-so-far-this-year",
      title: "Lego has launched 330 new products so far this year",
      source: "Fast Company",
      publishedAt: new Date("2026-08-25T16:12:54.000Z"),
      importance: 62,
    });
    const result = dedupeNewsArticles([original, republished]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hash-old");
    expect(result[0]!.publishedAt.toISOString()).toBe("2026-08-25T13:04:00.000Z");
    expect(result[0]!.url).toContain("lego-has-released");

    const reversed = dedupeNewsArticles([republished, original]);
    expect(reversed).toHaveLength(1);
    expect(reversed[0]!.id).toBe("hash-old");
    expect(reversed[0]!.publishedAt.toISOString()).toBe("2026-08-25T13:04:00.000Z");
  });
});

describe("filterNewsArticlesForQuery top ranking", () => {
  const now = Date.now();

  it("keeps the last 4 hours, drops RSS and X, and ranks by score", () => {
    const high = makeArticle({
      id: "high",
      url: "https://wire.example/high",
      origin: "gloomberb-cloud",
      importance: 40,
      publishedAt: new Date(now - 30 * 60 * 1000),
    });
    const higher = makeArticle({
      id: "higher",
      url: "https://wire.example/higher",
      origin: "adjacent",
      importance: 90,
      publishedAt: new Date(now - 90 * 60 * 1000),
    });
    const stale = makeArticle({
      id: "stale",
      url: "https://wire.example/stale",
      origin: "gloomberb-cloud",
      importance: 99,
      publishedAt: new Date(now - TOP_NEWS_WINDOW_MS - 60_000),
    });
    const rss = makeArticle({
      id: "rss",
      url: "https://rss.example/1",
      origin: "rss",
      importance: 95,
      publishedAt: new Date(now - 10 * 60 * 1000),
    });
    const tweet = makeArticle({
      id: "x",
      url: "https://x.com/1",
      origin: "x-feed",
      importance: 94,
      publishedAt: new Date(now - 5 * 60 * 1000),
    });

    const ranked = filterNewsArticlesForQuery(
      [high, stale, rss, tweet, higher],
      { feed: "top" },
    );

    expect(ranked.map((item) => item.id)).toEqual(["higher", "high"]);
  });

  it("does not apply top ranking to latest", () => {
    const rss = makeArticle({
      id: "rss",
      url: "https://rss.example/1",
      origin: "rss",
      importance: 20,
      publishedAt: new Date(now - 10 * 60 * 1000),
    });
    const wire = makeArticle({
      id: "wire",
      url: "https://wire.example/1",
      origin: "gloomberb-cloud",
      importance: 90,
      publishedAt: new Date(now - 20 * 60 * 1000),
    });

    const latest = filterNewsArticlesForQuery([rss, wire], { feed: "latest" });
    expect(latest.map((item) => item.id)).toEqual(["rss", "wire"]);
  });
});
