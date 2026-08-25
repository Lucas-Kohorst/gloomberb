import { describe, expect, it } from "bun:test";
import { dedupeNewsArticles } from "./news-model";
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
