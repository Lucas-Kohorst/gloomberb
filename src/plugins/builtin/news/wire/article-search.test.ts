import { describe, expect, test } from "bun:test";
import type { NewsArticle } from "../../../../news/types";
import {
  looksLikeArticleQuery,
  searchNewsArticles,
  tokenizeArticleQuery,
} from "./article-search";

function article(overrides: Partial<NewsArticle> & Pick<NewsArticle, "id" | "title" | "source">): NewsArticle {
  return {
    url: `https://example.com/${overrides.id}`,
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
    ...overrides,
  };
}

const hormuz = article({
  id: "hormuz",
  title: "Iran Threatens to Close the Strait of Hormuz",
  source: "Reuters",
  summary: "Shipping risk rises as Tehran warns it may shut the strait.",
  publishedAt: new Date("2026-08-14T18:00:00Z"),
});

const other = article({
  id: "fed",
  title: "Fed holds rates as inflation cools",
  source: "CNBC Top News",
  publishedAt: new Date("2026-08-13T12:00:00Z"),
});

describe("looksLikeArticleQuery", () => {
  test("treats article, news, and ART lookups as article searches", () => {
    expect(looksLikeArticleQuery("article on the strait")).toBe(true);
    expect(looksLikeArticleQuery("ART hormuz")).toBe(true);
    expect(looksLikeArticleQuery("open press story")).toBe(true);
    expect(looksLikeArticleQuery("ADI")).toBe(false);
    expect(looksLikeArticleQuery("nvda")).toBe(false);
  });
});

describe("searchNewsArticles", () => {
  test("matches headlines after dropping filler and intent words", () => {
    expect(tokenizeArticleQuery("article on the strait of hormuz")).toEqual(["strait", "hormuz"]);
    const matches = searchNewsArticles([hormuz, other], "article on the strait of hormuz");
    expect(matches.map((item) => item.id)).toEqual(["hormuz"]);
  });

  test("returns most recent articles when the query is only an intent word", () => {
    const matches = searchNewsArticles([other, hormuz], "article");
    expect(matches.map((item) => item.id)).toEqual(["hormuz", "fed"]);
  });

  test("strips the ART command prefix so local headlines match immediately", () => {
    const trump = article({
      id: "trump",
      title: "Trump administration pauses contentious trade talks",
      source: "AP",
    });
    expect(tokenizeArticleQuery("art trum")).toEqual(["trum"]);
    expect(searchNewsArticles([trump, other], "ART trum").map((item) => item.id)).toEqual(["trump"]);
  });
});
