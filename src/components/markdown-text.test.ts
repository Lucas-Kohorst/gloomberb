import { describe, expect, test } from "bun:test";
import { parseMarkdownDocument, parseMarkdownLine } from "./markdown-text";

function rendered(line: string): string {
  const parsed = parseMarkdownLine(line);
  const indent = parsed.indent ? " ".repeat(parsed.indent) : "";
  return indent + parsed.segments.map((segment) => segment.text).join("");
}

function renderedDocument(text: string): string[] {
  return parseMarkdownDocument(text).map((parsed) => {
    const indent = parsed.indent ? " ".repeat(parsed.indent) : "";
    return indent + parsed.segments.map((segment) => segment.text).join("");
  });
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

describe("inline HTML", () => {
  // CFTC filings wrap headings in `<u>`; scraped pages carry stray tags too.
  test("drops tags and keeps the text they wrap", () => {
    expect(rendered("## <u>PJM AEP-DAYTON HUB Contract</u>"))
      .toBe("PJM AEP-DAYTON HUB Contract");
    expect(rendered("a <br> b")).toBe("a  b");
    expect(rendered('text <span class="x">inner</span>')).toBe("text inner");
  });

  test("an autolink is still a link, not a tag", () => {
    const parsed = parseMarkdownLine("<https://example.com/a>");
    expect(parsed.segments[0]!.link).toBe("https://example.com/a");
  });
});

describe("pipe tables", () => {
  const table = [
    "|ITEM|SPECIFICATION|",
    "|---|---|",
    "|Contract Code|FKA01|",
    "|Settlement Method|Financial|",
  ].join("\n");

  test("aligns columns and drops the divider row", () => {
    // Widest first cell is "Settlement Method" (17), plus a two-space gap.
    expect(renderedDocument(table)).toEqual([
      "ITEM               SPECIFICATION",
      "Contract Code      FKA01",
      "Settlement Method  Financial",
    ]);
  });

  test("bolds the row above the divider", () => {
    const rows = parseMarkdownDocument(table);
    expect(rows[0]!.segments.filter((s) => s.text.trim()).every((s) => s.bold)).toBe(true);
    expect(rows[1]!.segments.some((s) => s.bold)).toBe(false);
  });

  test("parses inline markup inside cells", () => {
    expect(renderedDocument("|**Code**|[Doc](https://x/y)|")).toEqual(["Code  Doc"]);
  });

  test("surrounding prose is unaffected", () => {
    expect(renderedDocument(`intro\n\n${table}\n\nafter`)).toEqual([
      "intro",
      "",
      "ITEM               SPECIFICATION",
      "Contract Code      FKA01",
      "Settlement Method  Financial",
      "",
      "after",
    ]);
  });

  test("a divider with no header above it still renders the rows", () => {
    expect(renderedDocument("|---|---|\n|a|b|")).toEqual(["a  b"]);
  });
});
