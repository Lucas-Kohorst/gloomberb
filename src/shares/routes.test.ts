import { describe, expect, test } from "bun:test";
import {
  buildTerminalArticleUrl,
  buildTerminalShareUrl,
  isShareDocumentPath,
  parseShortShareId,
} from "./routes";

describe("share document routing", () => {
  test("claims the paths the worker must answer with the slim page", () => {
    expect(isShareDocumentPath("/article")).toBe(true);
    expect(isShareDocumentPath("/s/abcdef1234567890")).toBe(true);
  });

  test("leaves the terminal SPA and its assets alone", () => {
    for (const path of ["/", "/web-main.js", "/share.html", "/api/share/abcdef12", "/s/a/b"]) {
      expect(isShareDocumentPath(path)).toBe(false);
    }
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
