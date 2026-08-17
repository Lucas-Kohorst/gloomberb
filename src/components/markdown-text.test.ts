import { describe, expect, test } from "bun:test";
import { parseMarkdownLine } from "./markdown-text";
import { stripJinaPreamble } from "../plugins/builtin/shared/jina-reader";

function rendered(line: string): string {
  const parsed = parseMarkdownLine(line);
  const indent = parsed.indent ? " ".repeat(parsed.indent) : "";
  return indent + parsed.segments.map((segment) => segment.text).join("");
}

describe("parseMarkdownLine links", () => {
  test("renders the label and hides the URL", () => {
    const parsed = parseMarkdownLine("[All ETFs](https://seekingalpha.com/screeners/etfs/967aaa441700-All-ETFs#source=x%3Ay)");
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0]!.text).toBe("All ETFs");
    expect(parsed.segments[0]!.link).toBe(
      "https://seekingalpha.com/screeners/etfs/967aaa441700-All-ETFs#source=x%3Ay",
    );
  });

  test("keeps surrounding prose around an inline link", () => {
    expect(rendered("See [the filing](https://sec.gov/x) for details."))
      .toBe("See the filing for details.");
  });

  test("falls back to the URL when the label is empty", () => {
    expect(rendered("[](https://example.com/a)")).toBe("https://example.com/a");
  });

  test("renders an autolink as its URL", () => {
    const parsed = parseMarkdownLine("<https://example.com/a>");
    expect(parsed.segments[0]!.link).toBe("https://example.com/a");
  });

  test("drops image markup but keeps meaningful alt text", () => {
    expect(rendered("![](https://cdn.example.com/pixel.gif)")).toBe("");
    expect(rendered("![Chart of yields](https://cdn.example.com/c.png)")).toBe("Chart of yields");
  });

  test("a link inside a list item keeps the bullet and the label", () => {
    expect(rendered("  * [Comparisons](https://seekingalpha.com/comparison)"))
      .toBe("  - Comparisons");
  });
});

describe("parseMarkdownLine block syntax", () => {
  test("bullet markers with no content render nothing", () => {
    expect(parseMarkdownLine("*").segments).toEqual([]);
    expect(parseMarkdownLine("  -  ").segments).toEqual([]);
  });

  test("thematic breaks render nothing", () => {
    expect(parseMarkdownLine("---").segments).toEqual([]);
    expect(parseMarkdownLine("***").segments).toEqual([]);
  });

  test("headings are recognised through level six", () => {
    expect(parseMarkdownLine("###### Deep").heading).toBe(true);
    expect(rendered("###### Deep")).toBe("Deep");
    expect(parseMarkdownLine("####### Seven").heading).toBeUndefined();
  });

  test("blockquotes are marked and dimmed", () => {
    const parsed = parseMarkdownLine("> quoted claim");
    expect(rendered("> quoted claim")).toBe("| quoted claim");
    expect(parsed.segments.every((segment) => segment.dim)).toBe(true);
  });

  test("inline emphasis still parses", () => {
    expect(rendered("**bold** and *italic* and `code`")).toBe("bold and italic and code");
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
