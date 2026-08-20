import { describe, expect, test } from "bun:test";
import { archiveIsOpenUrl, publisherArticleUrl } from "./archive";

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

describe("archiveIsOpenUrl", () => {
  test("opens archive.is plus the raw publisher URL", () => {
    expect(archiveIsOpenUrl(FAST_COMPANY)).toBe(`https://archive.is/${FAST_COMPANY}`);
  });

  test("does not archive gloomberb share URLs", () => {
    expect(archiveIsOpenUrl("https://terminal.kohor.st/s/KiRtm4eCzg3l")).toBeNull();
    expect(archiveIsOpenUrl("https://terminal.kohor.st/s/KIRTm4eCzg3l")).toBeNull();
  });
});
