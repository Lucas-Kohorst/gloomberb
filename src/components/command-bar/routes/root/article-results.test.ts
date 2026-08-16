import { describe, expect, test } from "bun:test";
import type { NewsArticle } from "../../../../news/types";
import { buildArticleSearchResultItems } from "./article-results";

function article(title: string, source: string): NewsArticle {
  return {
    id: title,
    title,
    source,
    url: `https://example.com/${title}`,
    publishedAt: new Date("2026-08-14T12:00:00Z"),
    topic: "general",
    topics: [],
    sectors: [],
    categories: [],
    tickers: [],
    scores: { importance: 50, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 50,
  };
}

describe("buildArticleSearchResultItems", () => {
  test("offers the matching Adjacent Press article to open", () => {
    const opened: string[] = [];
    const items = buildArticleSearchResultItems({
      articles: [
        article("Iran Threatens to Close the Strait of Hormuz", "Adjacent Press"),
        article("Fed holds rates", "CNBC Top News"),
      ],
      query: "adjacent article on the strait",
      phase: "ready",
      onOpen: (item) => {
        opened.push(item.id);
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.label).toContain("Hormuz");
    expect(items[0]?.detail).toBe("Adjacent Press");
    items[0]?.action();
    expect(opened).toEqual(["Iran Threatens to Close the Strait of Hormuz"]);
  });

  test("shows a lookup row while subscribed feeds are still loading", () => {
    const items = buildArticleSearchResultItems({
      articles: [],
      query: "adjacent article on the strait",
      phase: "loading",
      onOpen: () => {},
    });
    expect(items.map((item) => item.label)).toEqual(["Looking up articles…"]);
  });
});
