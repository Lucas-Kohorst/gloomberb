import { describe, expect, test } from "bun:test";
import { tokenizeInlineContent } from "./inline-content-tokenizer";

const md = (text: string) => tokenizeInlineContent(text, { markdown: true });

describe("tokenizeInlineContent", () => {
  test("returns mixed text, link, ticker, and username tokens in one pass", () => {
    expect(tokenizeInlineContent("Read https://example.com then watch $NVDA with @lisa")).toEqual([
      { kind: "text", value: "Read " },
      { kind: "link", value: "https://example.com", url: "https://example.com" },
      { kind: "text", value: " then watch " },
      { kind: "ticker", value: "$NVDA", symbol: "NVDA" },
      { kind: "text", value: " with " },
      { kind: "username", value: "@lisa", username: "lisa" },
    ]);
  });

  test("does not split ticker-like text out of links", () => {
    expect(tokenizeInlineContent("Read https://example.com/$TSLA before $NVDA")).toEqual([
      { kind: "text", value: "Read " },
      { kind: "link", value: "https://example.com/$TSLA", url: "https://example.com/$TSLA" },
      { kind: "text", value: " before " },
      { kind: "ticker", value: "$NVDA", symbol: "NVDA" },
    ]);
  });

  test("does not split username-like text out of links or email addresses", () => {
    expect(tokenizeInlineContent("Email desk@example.com or read https://x.com/@desk")).toEqual([
      { kind: "text", value: "Email desk@example.com or read " },
      { kind: "link", value: "https://x.com/@desk", url: "https://x.com/@desk" },
    ]);
  });

  test("leaves markdown markers alone unless markdown is requested", () => {
    expect(tokenizeInlineContent("**very** [docs](https://example.com)")).toEqual([
      { kind: "text", value: "**very** [docs](" },
      { kind: "link", value: "https://example.com", url: "https://example.com" },
      { kind: "text", value: ")" },
    ]);
  });

  test("styles markdown emphasis without leaking the markers into the text", () => {
    expect(md("**very** *soft* ~~gone~~ `raw`")).toEqual([
      { kind: "text", value: "very", style: { bold: true } },
      { kind: "text", value: " " },
      { kind: "text", value: "soft", style: { italic: true } },
      { kind: "text", value: " " },
      { kind: "text", value: "gone", style: { strike: true } },
      { kind: "text", value: " " },
      { kind: "text", value: "raw", style: { code: true } },
    ]);
  });

  test("keeps tickers and mentions live inside emphasis but literal inside code", () => {
    expect(md("**$NVDA @lisa** `$NVDA @lisa`")).toEqual([
      { kind: "ticker", value: "$NVDA", symbol: "NVDA" },
      { kind: "text", value: " ", style: { bold: true } },
      { kind: "username", value: "@lisa", username: "lisa" },
      { kind: "text", value: " " },
      { kind: "text", value: "$NVDA @lisa", style: { code: true } },
    ]);
  });

  test("resolves markdown links and leaves unsafe or malformed hrefs as text", () => {
    expect(md("[docs](https://example.com) [bad](javascript:alert(1)) [typo](https;)")).toEqual([
      { kind: "link", value: "docs", url: "https://example.com" },
      { kind: "text", value: " " },
      { kind: "text", value: "[bad](javascript:alert(1)" },
      { kind: "text", value: ") " },
      { kind: "text", value: "[typo](https;)" },
    ]);
  });

  test("leaves snake_case identifiers alone", () => {
    expect(md("call get_user_id now")).toEqual([
      { kind: "text", value: "call get_user_id now" },
    ]);
  });
});
