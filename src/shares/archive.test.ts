import { describe, expect, test } from "bun:test";
import {
  archiveIsLookupUrl,
  archiveIsSubmitUrl,
  isArchiveSnapshotUrl,
  lookupArchiveIsSnapshot,
  parseArchiveLookupResponse,
  publisherArticleUrl,
} from "./archive";

const FAST_COMPANY =
  "https://www.fastcompany.com/91593204/housing-market-homebuilding-berkshire-hathaway-taylor-morrison-inside-details";

describe("publisherArticleUrl", () => {
  test("keeps the publisher URL and rejects gloomberb share URLs", () => {
    expect(publisherArticleUrl(FAST_COMPANY)).toBe(FAST_COMPANY);
    expect(publisherArticleUrl("https://terminal.kohor.st/s/cqT4HwQPu8J2")).toBeNull();
    expect(publisherArticleUrl("https://terminal.kohor.st/article?a=abc")).toBeNull();
    expect(publisherArticleUrl("https://archive.is/AbCd12")).toBeNull();
    expect(publisherArticleUrl("not a url")).toBeNull();
  });
});

describe("archive.is URLs", () => {
  test("lookup uses the raw publisher URL; submit percent-encodes it", () => {
    expect(archiveIsLookupUrl(FAST_COMPANY)).toBe(`https://archive.is/${FAST_COMPANY}`);
    expect(archiveIsSubmitUrl(FAST_COMPANY)).toBe(
      `https://archive.is/submit/?url=${encodeURIComponent(FAST_COMPANY)}`,
    );
    expect(archiveIsSubmitUrl(FAST_COMPANY)).toContain("https%3A%2F%2Fwww.fastcompany.com%2F91593204%2F");
  });

  test("snapshot URLs are real archive.is paths, not lookup or submit pages", () => {
    expect(isArchiveSnapshotUrl("https://archive.is/AbCd12")).toBe(true);
    expect(isArchiveSnapshotUrl("https://archive.is/20240101120000/https://example.com/x")).toBe(true);
    expect(isArchiveSnapshotUrl(`https://archive.is/${FAST_COMPANY}`)).toBe(false);
    expect(isArchiveSnapshotUrl(`https://archive.is/submit/?url=${encodeURIComponent(FAST_COMPANY)}`)).toBe(false);
    expect(isArchiveSnapshotUrl("https://example.com/AbCd12")).toBe(false);
  });
});

describe("parseArchiveLookupResponse", () => {
  test("uses a redirect Location when it is a snapshot", () => {
    expect(parseArchiveLookupResponse({
      sourceUrl: FAST_COMPANY,
      status: 302,
      location: "https://archive.is/XyZ9ab",
      body: "",
    })).toEqual({ status: "snapshot", url: "https://archive.is/XyZ9ab" });
  });

  test("does not invent a snapshot when the lookup page has none", () => {
    expect(parseArchiveLookupResponse({
      sourceUrl: FAST_COMPANY,
      status: 200,
      location: null,
      body: "<html><title>No results</title><p>No results</p></html>",
    })).toEqual({ status: "submit", url: archiveIsSubmitUrl(FAST_COMPANY) });
  });

  test("takes a snapshot href from the lookup page and not a guessed id", () => {
    expect(parseArchiveLookupResponse({
      sourceUrl: FAST_COMPANY,
      status: 200,
      location: null,
      body: `<html><a href="https://archive.is/20240101120000/${FAST_COMPANY}">snapshot</a></html>`,
    })).toEqual({
      status: "snapshot",
      url: `https://archive.is/20240101120000/${FAST_COMPANY}`,
    });
  });

  test("fails visibly on rate limits and bot walls instead of faking a snapshot", () => {
    expect(parseArchiveLookupResponse({
      sourceUrl: FAST_COMPANY,
      status: 429,
      location: null,
      body: "too many requests",
    })).toEqual({ status: "error", message: "archive.is rate-limited this lookup." });

    expect(parseArchiveLookupResponse({
      sourceUrl: FAST_COMPANY,
      status: 200,
      location: null,
      body: "<html><title>Just a moment...</title>Enable JavaScript and cookies to continue</html>",
    })).toEqual({ status: "error", message: "archive.is blocked this lookup." });
  });
});

describe("lookupArchiveIsSnapshot", () => {
  test("refuses gloomberb share URLs before contacting archive.is", async () => {
    const calls: string[] = [];
    const result = await lookupArchiveIsSnapshot(
      "https://terminal.kohor.st/s/cqT4HwQPu8J2",
      (async (input) => {
        calls.push(String(input));
        return new Response("nope");
      }),
    );
    expect(result.status).toBe("error");
    expect(calls).toEqual([]);
  });

  test("follows Lucas's lookup URL and returns submit when archive.is has none", async () => {
    const result = await lookupArchiveIsSnapshot(FAST_COMPANY, (async (input) => {
      expect(String(input)).toBe(`https://archive.is/${FAST_COMPANY}`);
      return new Response("<html>No results</html>", { status: 200 });
    }));
    expect(result).toEqual({ status: "submit", url: archiveIsSubmitUrl(FAST_COMPANY) });
  });
});
