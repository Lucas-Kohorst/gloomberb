import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  articleShareBodySource,
  ArticleShareView,
  articleShareNeedsReader,
  cftcFilingIdFromShare,
  cftcFilingMarkdownUrls,
  filingShareNeedsText,
  preferredArticleBody,
} from "./article-view";

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

describe("ArticleShareView", () => {
  test("prints source and publication date as document metadata", () => {
    const html = renderToStaticMarkup(createElement(ArticleShareView, {
      payload: {
        type: "news",
        id: "reuters-urn",
        title: "BRIEF-Situational Awareness Active In Options Market - CNBC",
        url: "https://www.reuters.com/article",
        source: "Reuters News",
        publishedAt: "2026-09-11T13:37:11.000Z",
        tickers: ["dln", "DLN", "msft"],
        summary: "Sept 11 (Reuters) - SITUATIONAL AWARENESS ACTIVE IN OPTIONS MARKET",
      },
    }));
    expect(html).toContain("share-public-title");
    expect(html).toContain("Source: Reuters News");
    expect(html).toContain("Publication Date:");
    expect(html).toContain("share-meta-sep");
    expect(html).toContain("SITUATIONAL AWARENESS ACTIVE IN OPTIONS MARKET");
    expect(html).toContain("view original");
    expect(html).toContain(">DLN<");
    expect(html).not.toContain("share-pane-grip");
    expect(html).not.toContain(" · ");
  });

  test("drops a glued site menu stored in the snapshot", () => {
    const html = renderToStaticMarkup(createElement(ArticleShareView, {
      payload: {
        type: "news",
        id: "crypto-briefing-zec",
        title: "Grayscale's Zcash ETF surpasses $915M in assets",
        url: "https://cryptobriefing.com/grayscale-zcash-etf",
        source: "Crypto Briefing",
        summary: [
          "FinancePrediction MarketsMacroAITechMarketsNewsletterAds",
          "",
          "Sections",
          "",
          "BitcoinDeFiEthereumNFTsAI AgentsRegulationWeb3BusinessEcosystem",
          "",
          "Searching...",
          "",
          "The first US-listed spot Zcash ETF has attracted over $270 million in net inflows and now holds roughly 3.5% of ZEC's total supply.",
        ].join("\n"),
      },
    }));
    expect(html).toContain("The first US-listed spot Zcash ETF");
    expect(html).not.toContain("FinancePrediction");
    expect(html).not.toContain("BitcoinDeFi");
    expect(html).not.toContain("Searching");
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

describe("CFTC filing shares", () => {
  test("loads the filing letter when the snapshot is only the list line", () => {
    expect(cftcFilingIdFromShare("cftc:4821")).toBe(4821);
    expect(cftcFilingIdFromShare("reuters:abc")).toBeNull();
    expect(filingShareNeedsText("cftc:4821", "KEX · Certified · DCM Products".length)).toBe(true);
    expect(filingShareNeedsText("cftc:4821", 800)).toBe(false);
    expect(cftcFilingMarkdownUrls(4821, "https://terminal.kohor.st")).toEqual([
      "https://terminal.kohor.st/api/data/adjacent/public/filings/4821/markdown",
      "https://api.adjacent.markets/api/v1/public/filings/4821/markdown",
    ]);
    const letter = "Dear Sir or Madam:\n\nKalshiEX LLC hereby requests confidential treatment.";
    expect(articleShareBodySource({
      type: "news",
      id: "cftc:4821",
      title: "Will Stephen Curry sign a contract extension",
      url: "",
      source: "CFTC",
      summary: "KEX · Certified · DCM Products",
    }, letter)).toEqual({ kind: "markdown", text: letter });
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
