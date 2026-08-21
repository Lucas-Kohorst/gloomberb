import { describe, expect, test } from "bun:test";
import {
  cleanJinaArticle,
  classifyReaderHttpFailure,
  classifyReaderThrow,
  htmlMarkupPresent,
  htmlToPlainText,
  isBoilerplateArticleBody,
  isPaywallStub,
  looksLikeHtmlDocument,
  preferredArticleBody,
  readableArticleText,
  readerFallbackNotice,
  shouldSkipJinaForKnownBody,
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

describe("htmlMarkupPresent", () => {
  test("detects real HTML elements and ignores autolinks and comparisons", () => {
    expect(htmlMarkupPresent("<p>full post</p>")).toBe(true);
    expect(htmlMarkupPresent("See <https://kalshi.com/markets> for the contracts.")).toBe(false);
    expect(htmlMarkupPresent("polls < 50%")).toBe(false);
  });
});

describe("readableArticleText", () => {
  test("strips an HTML document dump down to visible copy", () => {
    const dump = [
      "<!DOCTYPE html><html><head><style>nav{display:block}</style></head>",
      "<body><nav>Markets</nav><p>The S&amp;P 500 closed higher.</p></body></html>",
    ].join("");
    expect(looksLikeHtmlDocument(dump)).toBe(true);
    expect(htmlToPlainText(dump)).toContain("The S&amp;P 500 closed higher.");
    expect(htmlToPlainText(dump)).not.toContain("<style>");
    expect(readableArticleText(dump)).not.toContain("<nav>");
  });

  test("leaves markdown autolinks alone", () => {
    const body = "See <https://kalshi.com/markets> for the contracts.";
    expect(readableArticleText(body)).toBe(body);
  });
});

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

  test("drops a Substack paywall stub instead of publishing it as the article", () => {
    const raw = [
      "Title: Could Prediction Markets Start Having A Republican Problem",
      "",
      "Markdown Content:",
      "",
      "This post is for paying subscribers.",
      "",
      "Subscribe to continue reading.",
    ].join("\n");
    expect(isPaywallStub("This post is for paying subscribers.")).toBe(true);
    expect(cleanJinaArticle(raw)).toBe("");
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

  test("keeps the summary when extraction is a paywall stub", () => {
    expect(preferredArticleBody(
      "Kalshi is opening the door to institutions.",
      "This post is for paying subscribers. Subscribe to continue reading.",
    )).toBe("Kalshi is opening the door to institutions.");
  });
});

describe("classifyReaderHttpFailure", () => {
  test("treats Investing.com-style Jina abuse blocks as publisher blocked, not a raw 403", () => {
    const body = [
      "AbuseAlleviationError: Anonymous access to domain www.investing.com blocked until",
      "Fri Dec 30 2039 due to previous abuse found on https://www.investing.com/news/...:",
      "DDoS attack suspected: Too many requests",
    ].join(" ");
    const failure = classifyReaderHttpFailure(403, body);
    expect(failure.kind).toBe("blocked");
    expect(failure.status).toBe("blocked");
    expect(failure.message).toContain("blocks automated readers");
    expect(failure.message).not.toContain("403");
    expect(failure.status).not.toBe(failure.message);
  });

  test("keeps auth failures distinct from publisher blocks", () => {
    const failure = classifyReaderHttpFailure(401, "AuthenticationFailedError: Invalid API key");
    expect(failure.kind).toBe("auth");
    expect(failure.status).toBe("reader auth failed");
  });

  test("maps rate limits and server errors without leaking raw status into the body copy for blocks", () => {
    expect(classifyReaderHttpFailure(429).kind).toBe("blocked");
    expect(classifyReaderHttpFailure(503).kind).toBe("http");
    expect(classifyReaderHttpFailure(502).message).toContain("temporarily unavailable");
  });
});

describe("classifyReaderThrow", () => {
  test("maps abort and network errors to distinct kinds", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(classifyReaderThrow(abort).kind).toBe("timeout");
    expect(classifyReaderThrow(new TypeError("Failed to fetch")).kind).toBe("network");
  });

  test("passes through structured ReaderFailure objects thrown from HTTP handling", () => {
    const failure = classifyReaderHttpFailure(403, "AbuseAlleviationError: blocked");
    expect(classifyReaderThrow(Object.assign(new Error(failure.status), { readerFailure: failure }))).toEqual(failure);
  });
});

describe("shouldSkipJinaForKnownBody", () => {
  test("skips extraction only when RSS already returned a long article body", () => {
    expect(shouldSkipJinaForKnownBody("short teaser")).toBe(false);
    expect(shouldSkipJinaForKnownBody("x".repeat(500))).toBe(true);
  });

  test("does not skip Jina for a long HTML chrome dump or paywall stub", () => {
    const dump = `<!DOCTYPE html><html><body>${"<nav>Markets</nav>".repeat(40)}</body></html>`;
    expect(shouldSkipJinaForKnownBody(dump)).toBe(false);
    expect(shouldSkipJinaForKnownBody("This post is for paying subscribers. ".repeat(20))).toBe(false);
  });
});

describe("readerFallbackNotice", () => {
  test("only annotates the body when a summary fallback is present", () => {
    expect(readerFallbackNotice("blocked", true)).toContain("full text blocked");
    expect(readerFallbackNotice("blocked", false)).toBeNull();
    expect(readerFallbackNotice("network", true)).toContain("could not be loaded");
    expect(readerFallbackNotice(null, true)).toBeNull();
  });
});
