import { describe, expect, test } from "bun:test";
import {
  articleShareFromStored,
  articleShareStoreData,
  decodeArticleSharePayload,
  encodeArticleSharePayload,
  chartShareFromStored,
  isSpecOnlyChartShare,
  parseSharePayload,
  type ArticleSharePayload,
} from "./payload";

const article: ArticleSharePayload = {
  type: "news",
  id: "story-1",
  title: "Betting on the midterms passes 2024",
  url: "https://example.com/story",
  source: "Reuters",
  summary: "Wagers already exceed the last cycle.",
};

describe("article share codec", () => {
  test("round-trips a payload through a URL-safe encoding", () => {
    const encoded = encodeArticleSharePayload(article);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeArticleSharePayload(encoded)).toEqual(article);
  });

  test("survives non-ASCII titles", () => {
    const encoded = encodeArticleSharePayload({ ...article, title: "€ rally — 通貨" });
    expect(decodeArticleSharePayload(encoded)?.title).toBe("€ rally — 通貨");
  });

  test("rejects garbage rather than throwing", () => {
    expect(decodeArticleSharePayload("not-base64!!")).toBeNull();
    expect(decodeArticleSharePayload(btoa("[]"))).toBeNull();
  });

  test("rejects a payload missing the fields the view renders", () => {
    const { title: _title, ...withoutTitle } = article;
    expect(decodeArticleSharePayload(encodeArticleSharePayload(withoutTitle as ArticleSharePayload)))
      .toBeNull();
  });
});

describe("stored article snapshots", () => {
  test("round-trips reader fields through the Cloud envelope", () => {
    const stored = articleShareStoreData(article);
    expect(parseSharePayload({ kind: "article", data: stored })?.kind).toBe("article");
    expect(articleShareFromStored(stored)).toMatchObject({
      type: "news",
      id: "story-1",
      title: article.title,
      source: "Reuters",
      url: article.url,
      summary: article.summary,
    });
  });

  test("rebuilds a legacy title-and-text share for the reader", () => {
    expect(articleShareFromStored({
      title: "BRIEF",
      text: "Sept 11 (Reuters) - body",
      sourceUrl: "https://www.reuters.com/a",
    })).toMatchObject({
      type: "news",
      title: "BRIEF",
      url: "https://www.reuters.com/a",
      summary: "Sept 11 (Reuters) - body",
    });
  });
});

describe("parseSharePayload", () => {
  test("accepts each kind with its required shape", () => {
    expect(parseSharePayload("article", article)?.kind).toBe("article");
    expect(parseSharePayload("chart", { title: "C", panels: [], series: [] })?.kind).toBe("chart");
    expect(parseSharePayload("table", { title: "T", columns: [], rows: [] })?.kind).toBe("table");
  });

  test("rejects an unknown kind and a mismatched body", () => {
    expect(parseSharePayload("layout", {})).toBeNull();
    expect(parseSharePayload("chart", article)).toBeNull();
    expect(parseSharePayload("table", { title: "T", columns: [] })).toBeNull();
  });
});

describe("stored chart snapshots", () => {
  test("round-trips color, candles, and panels for the public chart", () => {
    const stored = {
      title: "AAPL",
      capturedAt: "2026-09-11T00:00:00Z",
      series: [{
        name: "AAPL",
        color: "#e0a458",
        style: "candles" as const,
        axis: "left" as const,
        panelId: "price",
        points: [{ x: "2025-01-02T00:00:00.000Z", y: 10, o: 8, h: 12, l: 7, c: 10 }],
      }],
      panels: [{ id: "price", label: "Price" }],
    };
    expect(parseSharePayload({ kind: "chart", data: stored })?.kind).toBe("chart");
    expect(chartShareFromStored(stored)).toMatchObject({
      title: "AAPL",
      panels: [{ id: "price", label: "Price" }],
      series: [{
        label: "AAPL",
        color: "#e0a458",
        style: "candles",
        panelId: "price",
        points: [{ v: 10, o: 8, h: 12, l: 7, c: 10 }],
      }],
    });
  });
});

describe("legacy chart shares", () => {
  test("identifies spec-only shares so they can be handed to the terminal", () => {
    expect(isSpecOnlyChartShare({ spec: { version: 1, series: [] } })).toBe(true);
  });

  test("does not claim snapshots or empty payloads", () => {
    expect(isSpecOnlyChartShare({ spec: { version: 1 }, series: [] })).toBe(false);
    expect(isSpecOnlyChartShare({ series: [] })).toBe(false);
    expect(isSpecOnlyChartShare(null)).toBe(false);
  });
});
