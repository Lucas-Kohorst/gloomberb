/** @jsxImportSource react */
import { Window } from "happy-dom";

// SanitizedHtmlBody parses with DOMParser, which only the browser build has.
const testWindow = new Window({ url: "https://terminal.kohor.st/" });
Object.defineProperty(globalThis, "DOMParser", {
  configurable: true,
  writable: true,
  value: testWindow.DOMParser,
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBody, SanitizedHtmlBody } from "./rich-text";

const markdown = (text: string) => renderToStaticMarkup(<MarkdownBody text={text} />);
const html = (source: string) => renderToStaticMarkup(<SanitizedHtmlBody html={source} />);

describe("shared article markdown", () => {
  test("joins wrapped lines into one paragraph and splits on blank lines", () => {
    const output = markdown("first line\nstill first\n\nsecond");
    expect(output).toContain("<p>first line still first</p>");
    expect(output).toContain("<p>second</p>");
  });

  test("renders headings, lists, quotes, and fenced code", () => {
    expect(markdown("## Heading")).toContain("<h2>Heading</h2>");
    expect(markdown("- one\n- two")).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(markdown("1. one\n2. two")).toContain("<ol>");
    expect(markdown("> quoted")).toContain("<blockquote>quoted</blockquote>");
    expect(markdown("```\nconst x = 1;\n```")).toContain("<pre><code>const x = 1;</code></pre>");
  });

  test("renders emphasis and inline code without leaking markers", () => {
    const output = markdown("**bold** and *italic* and `code`");
    expect(output).toContain("<strong>bold</strong>");
    expect(output).toContain("<em>italic</em>");
    expect(output).toContain("<code>code</code>");
  });

  test("keeps http links and drops unsafe schemes to plain text", () => {
    expect(markdown("[ok](https://example.com)")).toContain('href="https://example.com"');
    const unsafe = markdown("[click](javascript:alert(1))");
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).toContain("click");
  });

  test("renders markdown images with http sources", () => {
    expect(markdown("![House odds](https://kalshi.com/chart.png)"))
      .toContain('src="https://kalshi.com/chart.png"');
    expect(markdown("![x](javascript:alert(1))")).not.toContain("<img");
  });
});

describe("shared article HTML sanitization", () => {
  test("keeps allowed structure", () => {
    const output = html("<p>Hello <strong>world</strong></p><ul><li>one</li></ul>");
    expect(output).toContain("<p>Hello <strong>world</strong></p>");
    expect(output).toContain("<li>one</li>");
  });

  test("drops script and style content entirely", () => {
    const output = html('<p>safe</p><script>alert(1)</script><style>body{color:red}</style>');
    expect(output).toContain("safe");
    expect(output).not.toContain("alert(1)");
    expect(output).not.toContain("color:red");
  });

  test("never copies event handlers or inline styles", () => {
    const output = html('<p onclick="alert(1)" style="color:red">text</p>');
    expect(output).toBe("<div class=\"share-body\"><p>text</p></div>");
  });

  test("strips javascript: hrefs while keeping the link text", () => {
    const output = html('<a href="javascript:alert(1)">click</a>');
    expect(output).not.toContain("javascript:");
    expect(output).toContain("click");
  });

  test("drops images with unsafe sources and keeps http ones", () => {
    expect(html('<img src="https://example.com/a.png" alt="chart" />'))
      .toContain('src="https://example.com/a.png"');
    expect(html('<img src="javascript:alert(1)" />')).not.toContain("<img");
  });

  test("opens external links in a new tab without leaking the referrer", () => {
    const output = html('<a href="https://example.com">x</a>');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('rel="noreferrer noopener"');
  });
});
