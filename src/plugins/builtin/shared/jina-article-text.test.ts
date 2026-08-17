import { describe, expect, test } from "bun:test";
import {
  cleanJinaArticle,
  isBoilerplateArticleBody,
  preferredArticleBody,
  stripJinaPreamble,
} from "./jina-article-text";

// A CNBC extraction that came back as the site's top navigation instead of the
// article: repeated section labels, account chrome, and a duplicated headline.
const CNBC_NAV_DUMP = [
  "Title: Stocks close higher as investors weigh Fed path",
  "",
  "URL Source: https://www.cnbc.com/2026/08/17/stocks.html",
  "",
  "Markdown Content:",
  "",
  "Skip to content",
  "",
  "[Livestream](https://www.cnbc.com/live-tv/)",
  "",
  "[Markets](https://www.cnbc.com/markets/)",
  "",
  "Business",
  "",
  "Tech",
  "",
  "Politics & Policy",
  "",
  "Video",
  "",
  "Watchlist",
  "",
  "Investing Club",
  "",
  "PRO",
  "",
  "Menu",
  "",
  "Search quotes, news & videos",
].join("\n");

const SEEKING_ALPHA_DUMP = [
  "Title: Voya Emerging Markets High Dividend Equity Fund declares $0.055 dividend",
  "",
  "URL Source: https://seekingalpha.com/news/4480000-voya-emerging-markets-high-dividend-equity-fund-declares-0-055-dividend",
  "",
  "Published Time: 2026-08-01T13:00:00.000Z",
  "",
  "Markdown Content:",
  "",
  "Skip to content",
  "",
  "[Create Free Account](https://seekingalpha.com/account/register)",
  "",
  "[Sign In](https://seekingalpha.com/account/login)",
  "",
  "Stock Analysis",
  "",
  "* [Stock Screener](https://seekingalpha.com/screeners/stocks)",
  "* [ETF Screener](https://seekingalpha.com/screeners/etfs)",
  "* [Comparisons](https://seekingalpha.com/comparison)",
  "* [All ETFs](https://seekingalpha.com/etfs)",
  "",
  "Market News",
  "",
  "* [Market News](https://seekingalpha.com/market-news)",
  "* [Earnings](https://seekingalpha.com/earnings)",
  "* [IPOs](https://seekingalpha.com/ipos)",
  "* [Dividends](https://seekingalpha.com/dividends)",
  "",
  "Please enable Javascript and cookies to continue.",
  "",
  "We've detected that you have an ad-blocker enabled. Please disable it to continue.",
  "",
  "Voya Emerging Markets High Dividend Equity Fund declares $0.055 dividend",
  "",
  "Aug. 01, 2026 9:00 AM ET [IHD](https://seekingalpha.com/symbol/IHD)",
  "",
  "By: SA News Team",
  "",
  "* Voya Emerging Markets High Dividend Equity Fund declares $0.055/share monthly dividend, in line with previous.",
  "* Forward yield 8.91%",
  "* Payable Aug. 17; record Aug. 3; ex-div Aug. 3.",
  "* IHD Scorecard",
  "",
  "More on Voya Emerging Markets High Dividend Equity Fund",
  "",
  "* [IHD: Emerging Markets Equities CEF](https://seekingalpha.com/article/4858673)",
  "* [Voya to merge IHD into IEMLX](https://seekingalpha.com/article/4912141)",
].join("\n");

describe("stripJinaPreamble", () => {
  test("removes the reader metadata header", () => {
    const raw = [
      "Title: Some Article",
      "",
      "URL Source: https://example.com/a",
      "",
      "Published Time: 2026-08-17T00:00:00Z",
      "",
      "Markdown Content:",
      "",
      "The actual first paragraph.",
    ].join("\n");
    expect(stripJinaPreamble(raw)).toBe("The actual first paragraph.");
  });

  test("leaves content untouched when there is no preamble", () => {
    expect(stripJinaPreamble("## Heading\n\nBody")).toBe("## Heading\n\nBody");
  });

  test("does not strip an article that merely mentions the marker", () => {
    const body = "A post about Markdown Content:\nstill body text";
    expect(stripJinaPreamble(body)).toBe(body);
  });
});

describe("cleanJinaArticle", () => {
  test("keeps the Seeking Alpha dividend body and drops nav plus bot-wall copy", () => {
    const cleaned = cleanJinaArticle(SEEKING_ALPHA_DUMP);

    expect(cleaned).toContain("Voya Emerging Markets High Dividend Equity Fund declares $0.055 dividend");
    expect(cleaned).toContain("Aug. 01, 2026 9:00 AM ET");
    expect(cleaned).toContain("declares $0.055/share monthly dividend");
    expect(cleaned).toContain("Forward yield 8.91%");
    expect(cleaned).toContain("Payable Aug. 17; record Aug. 3");
    expect(cleaned).toContain("IHD Scorecard");
    expect(cleaned).toContain("More on Voya Emerging Markets High Dividend Equity Fund");
    expect(cleaned).toContain("IHD: Emerging Markets Equities CEF");

    expect(cleaned).not.toContain("Skip to content");
    expect(cleaned).not.toContain("Create Free Account");
    expect(cleaned).not.toContain("Stock Screener");
    expect(cleaned).not.toContain("enable Javascript");
    expect(cleaned).not.toContain("ad-blocker");
    expect(cleaned.startsWith("Stock Analysis")).toBe(false);
    expect(cleaned.startsWith("Market News")).toBe(false);
  });

  test("leaves a clean article body intact after dropping the preamble", () => {
    const raw = [
      "Title: Example Domain",
      "",
      "URL Source: https://example.com/",
      "",
      "Markdown Content:",
      "",
      "This domain is for use in documentation examples.",
      "",
      "Learn more at the IANA site.",
    ].join("\n");
    expect(cleanJinaArticle(raw)).toBe([
      "This domain is for use in documentation examples.",
      "",
      "Learn more at the IANA site.",
    ].join("\n"));
  });

  test("drops CNBC top-navigation dumps down to nothing", () => {
    // Regression: opening a CNBC article showed scraped site chrome
    // (Livestream, Business, Tech, Politics & Policy, Video, Watchlist,
    // Investing Club, PRO, Menu, Search quotes) instead of the story.
    const cleaned = cleanJinaArticle(CNBC_NAV_DUMP);
    expect(cleaned).not.toContain("Livestream");
    expect(cleaned).not.toContain("Investing Club");
    expect(cleaned).not.toContain("Search quotes");
    expect(cleaned).not.toContain("Politics & Policy");
    expect(isBoilerplateArticleBody(cleaned)).toBe(true);
  });

  test("returns empty when Jina only got a captcha or access-denied wall", () => {
    const raw = [
      "Title: Access to this page has been denied",
      "",
      "URL Source: https://seekingalpha.com/news/1",
      "",
      "Warning: This page maybe requiring CAPTCHA, please make sure you are authorized to access this page.",
      "",
      "Markdown Content:",
      "",
      "Before we continue...",
      "",
      "Press & Hold to confirm you are",
      "",
      "a human (and not a bot).",
    ].join("\n");
    expect(cleanJinaArticle(raw)).toBe("");
  });
});

describe("preferredArticleBody", () => {
  test("keeps a clean summary when extraction is mostly site chrome", () => {
    const summary = "The S&P 500 closed higher as investors weighed the Fed's rate path.";
    const junk = cleanJinaArticle(CNBC_NAV_DUMP);
    expect(preferredArticleBody(summary, junk)).toBe(summary);
  });

  test("prefers the extracted article when it is real, longer text", () => {
    const summary = "Short blurb.";
    const full = "A full multi-sentence article body. It explains the story in detail across lines.";
    expect(preferredArticleBody(summary, full)).toBe(full);
  });

  test("preserves a short legitimate newsletter body when there is no summary", () => {
    const body = "Open thread. Post whatever you want.";
    expect(preferredArticleBody("", body)).toBe(body);
  });

  test("falls back either way when one side is missing", () => {
    expect(preferredArticleBody("summary", null)).toBe("summary");
    expect(preferredArticleBody("", "extracted")).toBe("extracted");
    expect(preferredArticleBody("", "")).toBe("");
  });
});
