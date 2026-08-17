import { describe, expect, test } from "bun:test";
import {
  decodeArticleSharePayload,
  encodeArticleSharePayload,
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
