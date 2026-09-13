import { describe, expect, test } from "bun:test";
import {
  buildTerminalArticleUrl,
  buildTerminalShareUrl,
  encodeNewsPathId,
  isCanonicalNewsId,
  isShareDocumentPath,
  isShareScriptPath,
  parseNewsArticleId,
  parseShortShareId,
  publicNewsUrl,
} from "./routes";

describe("share document routing", () => {
  test("claims the paths the worker must answer with the slim page", () => {
    expect(isShareDocumentPath("/article")).toBe(true);
    expect(isShareDocumentPath("/s/abcdef1234567890")).toBe(true);
    expect(isShareDocumentPath("/l/0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isShareDocumentPath("/news/reuters-urn:newsml:reuters.com:20260911:nFWN4530A2")).toBe(true);
  });

  test("leaves the terminal SPA and its assets alone", () => {
    for (const path of ["/", "/web-main.js", "/share.html", "/api/share/abcdef12", "/s/a/b", "/news", "/news/"]) {
      expect(isShareDocumentPath(path)).toBe(false);
    }
  });

  test("claims the share page script, hashed or not", () => {
    expect(isShareScriptPath("/share-main.js")).toBe(true);
    expect(isShareScriptPath("/share-main.a1b2c3d4e5.js")).toBe(true);
    expect(isShareScriptPath("/web-main.js")).toBe(false);
    expect(isShareScriptPath("/share.html")).toBe(false);
  });

  test("claims an unresolvable id so the share page can say the link expired", () => {
    expect(parseShortShareId("/s/abc")).toBe("abc");
  });

  test("does not claim paths that are not a single share id", () => {
    expect(parseShortShareId("/s/")).toBeNull();
    expect(parseShortShareId("/s/has.a.dot")).toBeNull();
    expect(parseShortShareId("/s/abcdef1234567890/extra")).toBeNull();
    expect(parseShortShareId("/share/abcdef12")).toBeNull();
  });
});

describe("canonical news URLs", () => {
  const reuters = "reuters-urn:newsml:reuters.com:20260911:nFWN4530A2";

  test("keeps colons visible in the public path", () => {
    expect(isCanonicalNewsId(reuters)).toBe(true);
    expect(encodeNewsPathId(reuters)).toBe(reuters);
    expect(publicNewsUrl(reuters)).toBe(`https://terminal.kohor.st/news/${reuters}`);
    expect(parseNewsArticleId(`/news/${reuters}`)).toBe(reuters);
    expect(parseNewsArticleId(`/news/${encodeURIComponent(reuters)}`)).toBe(reuters);
    expect(parseNewsArticleId(`/api/news/${reuters}`)).toBe(reuters);
  });

  test("rejects empty, nested, or oversized ids", () => {
    expect(parseNewsArticleId("/news/")).toBeNull();
    expect(parseNewsArticleId("/news/a/b")).toBeNull();
    expect(isCanonicalNewsId(` ${reuters}`)).toBe(false);
    expect(isCanonicalNewsId("a".repeat(501))).toBe(false);
  });
});

describe("terminal hand-off URLs", () => {
  test("encodes the deep link so the query survives the round trip", () => {
    const url = new URL(buildTerminalShareUrl("abcdef1234567890", "https://terminal.kohor.st"));
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("gloomberb")).toBe("gloomberb://share?s=abcdef1234567890");
  });

  test("keeps an inline article payload intact", () => {
    const url = new URL(buildTerminalArticleUrl("eyJhIjoxfQ", "http://localhost:8787"));
    expect(url.origin).toBe("http://localhost:8787");
    expect(url.searchParams.get("gloomberb")).toBe("gloomberb://article?a=eyJhIjoxfQ");
  });
});
