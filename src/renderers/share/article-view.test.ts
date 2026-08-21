import { describe, expect, test } from "bun:test";
import { articleShareBodySource, articleShareNeedsReader, preferredArticleBody } from "./article-view";

describe("preferredArticleBody", () => {
  test("uses the extracted article when it adds text", () => {
    expect(preferredArticleBody("Short summary.", "A much longer extracted article body."))
      .toBe("A much longer extracted article body.");
  });

  test("keeps the payload summary when extraction came back thinner", () => {
    // Regression: a dead link returned a landing page, and the share replaced a
    // full Reuters summary with "This domain is for use in examples".
    const summary = "Betting on the midterms has already hit $133 million, surpassing 2024.";
    expect(preferredArticleBody(summary, "Example Domain. More information...")).toBe(summary);
  });

  test("falls back either way when one side is missing", () => {
    expect(preferredArticleBody("summary", null)).toBe("summary");
    expect(preferredArticleBody("", "extracted")).toBe("extracted");
    expect(preferredArticleBody("", null)).toBe("");
  });

  test("keeps the summary when cleaning left nothing to show", () => {
    expect(preferredArticleBody("The fund declared a $0.055 dividend.", "")).toBe(
      "The fund declared a $0.055 dividend.",
    );
  });
});

describe("articleShareBodySource", () => {
  test("does not render a raw HTML document dump as the article", () => {
    const dump = "<!DOCTYPE html><html><head><title>x</title></head><body><p>Visible paragraph.</p></body></html>";
    expect(articleShareBodySource({
      type: "news",
      id: "n",
      title: "t",
      url: "https://example.com/a",
      source: "Example",
      bodyHtml: dump,
      summary: "Visible paragraph.",
    })).toEqual({ kind: "markdown", text: "Visible paragraph." });
  });

  test("renders plaintext bodyHtml with autolinks as markdown, not HTML", () => {
    const bodyHtml = [
      "Kalshi is opening the door to institutions.",
      "",
      "See <https://kalshi.com/markets> for the contracts.",
    ].join("\n");
    expect(articleShareBodySource({
      type: "substack",
      id: "1",
      title: "Roundup",
      url: "https://eventhorizon.substack.com/p/example",
      source: "The Event Horizon",
      bodyHtml,
      subtitle: "Prediction markets news roundup: Kalshi embraces institutional trading.",
    })).toEqual({ kind: "markdown", text: bodyHtml });
  });
});

describe("articleShareNeedsReader", () => {
  test("loads the full Substack post when the share only stored a teaser", () => {
    expect(articleShareNeedsReader({
      type: "substack",
      id: "1",
      title: "Could Prediction Markets Start Having A Republican Problem",
      url: "https://eventhorizon.substack.com/p/example",
      source: "The Event Horizon",
      previewText: "There's a lot of noise about elections.",
    })).toBe(true);
  });

  test("skips Jina when the snapshot already has a long extracted post", () => {
    const body = "Kalshi is opening the door to institutional trading. ".repeat(12);
    expect(body.length).toBeGreaterThanOrEqual(400);
    expect(articleShareNeedsReader({
      type: "substack",
      id: "1",
      title: "Roundup",
      url: "https://eventhorizon.substack.com/p/example",
      source: "The Event Horizon",
      bodyHtml: body,
      summary: body,
    })).toBe(false);
  });

  test("still fetches a short news summary that is not a full article", () => {
    expect(articleShareNeedsReader({
      type: "news",
      id: "n",
      title: "t",
      url: "https://reuters.com/x",
      source: "Reuters",
      summary: "Prediction markets news roundup: Kalshi embraces institutional trading; betting on the fattest bear in Alaska; BTC price discovery",
    })).toBe(true);
  });

  test("does not refetch when the share already embedded HTML", () => {
    expect(articleShareNeedsReader({
      type: "substack",
      id: "1",
      title: "t",
      url: "https://eventhorizon.substack.com/p/example",
      source: "The Event Horizon",
      bodyHtml: "<p>full post</p>",
    })).toBe(false);
  });

  test("skips clustered wire stories that are not a single page to extract", () => {
    expect(articleShareNeedsReader({
      type: "news",
      id: "n",
      title: "t",
      url: "https://reuters.com/x",
      source: "Reuters",
      items: [{
        id: "i",
        sourceKey: "reuters",
        sourceName: "Reuters",
        title: "related",
        url: "https://reuters.com/y",
        publishedAt: "2026-08-20T00:00:00.000Z",
      }],
    })).toBe(false);
  });

  test("does not send x.com tweet URLs through Jina", () => {
    const tweet = {
      type: "news" as const,
      id: "x:123",
      title: "Markets rally on NVDA earnings",
      url: "https://x.com/marketsbot/status/123",
      source: "@marketsbot",
      summary: "Markets rally on NVDA earnings",
      categories: ["twitter"],
    };
    expect(articleShareNeedsReader(tweet)).toBe(false);
    expect(articleShareNeedsReader({
      ...tweet,
      url: "https://twitter.com/marketsbot/status/123",
    })).toBe(false);
    expect(articleShareNeedsReader({
      ...tweet,
      url: "https://www.x.com/marketsbot/status/123",
    })).toBe(false);
  });
});
