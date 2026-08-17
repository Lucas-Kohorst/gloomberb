import { describe, it, expect } from "bun:test";
import {
  canonicalArticleUrl,
  dedupeNewsArticles,
  titleSourceKey,
} from "../../../../news/news-model";
import { filterFirehoseArticles } from "./firehose";
import type { NewsArticle } from "../../../../news/types";

function makeArticle(overrides: Partial<NewsArticle> & { url: string }): NewsArticle {
  return {
    id: overrides.id ?? overrides.url,
    title: overrides.title ?? "Test headline",
    url: overrides.url,
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
    summary: overrides.summary,
  };
}

describe("canonicalArticleUrl", () => {
  it("strips utm tracking parameters", () => {
    const url = canonicalArticleUrl(
      "https://example.com/article?utm_source=twitter&utm_medium=social&utm_campaign=fired",
    );
    expect(url).toBe("https://example.com/article");
  });

  it("preserves non-tracking parameters", () => {
    const url = canonicalArticleUrl("https://example.com/article?page=2&ref=feed");
    expect(url).toBe("https://example.com/article?page=2");
  });

  it("strips fragments", () => {
    const url = canonicalArticleUrl("https://example.com/article#section-1");
    expect(url).toBe("https://example.com/article");
  });

  it("strips trailing slash", () => {
    const url = canonicalArticleUrl("https://example.com/article/");
    expect(url).toBe("https://example.com/article");
  });

  it("collapses same story with different tracking params to same key", () => {
    const a = canonicalArticleUrl("https://reuters.com/story?utm_source=rss");
    const b = canonicalArticleUrl("https://reuters.com/story?fbclid=abc123");
    const c = canonicalArticleUrl("https://reuters.com/story");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("returns null for empty string", () => {
    expect(canonicalArticleUrl("")).toBeNull();
    expect(canonicalArticleUrl("   ")).toBeNull();
  });

  it("handles invalid URLs by stripping query and fragment", () => {
    const url = canonicalArticleUrl("not-a-url/path?x=1#frag");
    expect(url).toBe("not-a-url/path");
  });
});

describe("titleSourceKey", () => {
  it("normalises title and source into a stable key", () => {
    const key = titleSourceKey("Fed Cuts Rates by 50bps!", "Reuters");
    expect(key).toBe("t:reuters:fed cuts rates by 50bps");
  });

  it("ignores case and punctuation", () => {
    const a = titleSourceKey("MARKET CRASHES: What You Need To Know", "Bloomberg");
    const b = titleSourceKey("market crashes  what you need to know", "bloomberg");
    expect(a).toBe(b);
  });

  it("returns empty string when title is empty", () => {
    expect(titleSourceKey("", "Reuters")).toBe("");
    expect(titleSourceKey("   ", "Reuters")).toBe("");
  });
});

describe("dedupeNewsArticles", () => {
  it("dedupes by canonical URL across sources", () => {
    const a = makeArticle({
      id: "rss-1",
      url: "https://reuters.com/story?utm_source=rss",
      source: "RSS",
      importance: 40,
    });
    const b = makeArticle({
      id: "adjacent-1",
      url: "https://reuters.com/story?utm_source=adjacent",
      source: "Adjacent",
      importance: 80,
    });
    const result = dedupeNewsArticles([a, b]);
    expect(result).toHaveLength(1);
    // Higher importance wins.
    expect(result[0]!.importance).toBe(80);
  });

  it("dedupes by trailing-slash-normalised URL", () => {
    const a = makeArticle({ id: "a", url: "https://example.com/post/" });
    const b = makeArticle({ id: "b", url: "https://example.com/post" });
    const result = dedupeNewsArticles([a, b]);
    expect(result).toHaveLength(1);
  });

  it("dedupes by fragment-stripped URL", () => {
    const a = makeArticle({ id: "a", url: "https://example.com/post#section" });
    const b = makeArticle({ id: "b", url: "https://example.com/post" });
    const result = dedupeNewsArticles([a, b]);
    expect(result).toHaveLength(1);
  });

  it("falls back to title+source key when URL is empty", () => {
    const a = makeArticle({
      id: "a",
      url: "",
      title: "Fed cuts rates",
      source: "Bloomberg",
    });
    const b = makeArticle({
      id: "b",
      url: "",
      title: "Fed cuts rates",
      source: "Bloomberg",
    });
    const result = dedupeNewsArticles([a, b]);
    expect(result).toHaveLength(1);
  });

  it("does NOT dedupe same title from different sources", () => {
    const a = makeArticle({
      id: "a",
      url: "",
      title: "Fed cuts rates",
      source: "Bloomberg",
    });
    const b = makeArticle({
      id: "b",
      url: "",
      title: "Fed cuts rates",
      source: "Reuters",
    });
    const result = dedupeNewsArticles([a, b]);
    expect(result).toHaveLength(2);
  });

  it("sorts by publishedAt descending", () => {
    const items = [
      makeArticle({ id: "old", url: "https://a.com/1", publishedAt: new Date("2025-01-01") }),
      makeArticle({ id: "new", url: "https://a.com/2", publishedAt: new Date("2025-06-01") }),
      makeArticle({ id: "mid", url: "https://a.com/3", publishedAt: new Date("2025-03-01") }),
    ];
    const result = dedupeNewsArticles(items);
    expect(result[0]!.id).toBe("new");
    expect(result[1]!.id).toBe("mid");
    expect(result[2]!.id).toBe("old");
  });

  it("preserves provenance: different URLs from different sources are kept", () => {
    const items = [
      makeArticle({ id: "rss", url: "https://rss.com/1", source: "RSS" }),
      makeArticle({ id: "adj", url: "https://adjacent.com/1", source: "Adjacent" }),
      makeArticle({ id: "sub", url: "https://substack.com/p/1", source: "Substack" }),
    ];
    const result = dedupeNewsArticles(items);
    expect(result).toHaveLength(3);
  });
});

describe("filterFirehoseArticles", () => {
  const articles: NewsArticle[] = [
    makeArticle({
      id: "1",
      url: "https://a.com/1",
      title: "Fed cuts interest rates",
      source: "Reuters",
      tickers: ["SPY"],
      categories: ["macro"],
    }),
    makeArticle({
      id: "2",
      url: "https://b.com/2",
      title: "Apple announces new iPad",
      source: "Bloomberg",
      tickers: ["AAPL"],
      categories: ["tech"],
    }),
    makeArticle({
      id: "3",
      url: "https://c.com/3",
      title: "Oil prices surge on OPEC cuts",
      source: "WSJ",
      tickers: ["XLE"],
      categories: ["energy"],
    }),
  ];

  it("returns all articles when query is empty", () => {
    expect(filterFirehoseArticles(articles, "")).toHaveLength(3);
    expect(filterFirehoseArticles(articles, "   ")).toHaveLength(3);
  });

  it("filters by title keyword", () => {
    const result = filterFirehoseArticles(articles, "Fed");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
  });

  it("filters by source name", () => {
    const result = filterFirehoseArticles(articles, "Bloomberg");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });

  it("filters by ticker", () => {
    const result = filterFirehoseArticles(articles, "AAPL");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });

  it("filters by category", () => {
    const result = filterFirehoseArticles(articles, "energy");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("3");
  });

  it("matches across multiple tokens (AND logic)", () => {
    const result = filterFirehoseArticles(articles, "Apple Bloomberg");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });

  it("returns empty when no articles match", () => {
    expect(filterFirehoseArticles(articles, "bitcoin")).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const result = filterFirehoseArticles(articles, "opec");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("3");
  });
});
