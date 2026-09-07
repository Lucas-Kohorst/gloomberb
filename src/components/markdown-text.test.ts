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

  test("does not let a URL swallow the next sentence", () => {
    const parsed = parseMarkdownLine(
      "found at: https://www.jacksonhole.com.These instructions",
    );
    expect(parsed.segments[0]!.text).toContain("found at:");
    const link = parsed.segments.find((segment) => segment.link);
    expect(link?.link).toBe("https://www.jacksonhole.com");
    expect(parsed.segments.map((segment) => segment.text).join("")).toContain("These instructions");
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

  test("keeps a space when a tag sat between words with no surrounding spaces", () => {
    expect(rendered("Jackson<br>Hole<br>Mountain")).toBe("Jackson Hole Mountain");
    expect(rendered("a<br/>b")).toBe("a b");
    expect(rendered("if<br>any,<br>in<br>on")).toBe("if any, in on");
  });

  test("an autolink is still a link, not a tag", () => {
    const parsed = parseMarkdownLine("<https://example.com/a>");
    expect(parsed.segments[0]!.link).toBe("https://example.com/a");
  });
});

describe("redlines", () => {
  test("renders <s> deletions as strikethrough instead of flattening them", () => {
    const parsed = parseMarkdownLine(
      "snowfall in <area> <s>during</s> <time period><s>asmeasuredandreportedbytheNationalWeatherService</s>.",
    );
    const strikes = parsed.segments.filter((segment) => segment.strikethrough);
    expect(strikes.map((segment) => segment.text)).toEqual([
      "during",
      "asmeasuredandreportedbytheNationalWeatherService",
    ]);
    expect(parsed.segments.some((segment) => segment.text === "<area>")).toBe(true);
    expect(parsed.segments.some((segment) => segment.text === "<time period>")).toBe(true);
  });

  test("inserts a space when a closing strike tag sits against the next word", () => {
    expect(rendered("<s>Weather Service</s>Source Agency"))
      .toBe("Weather Service Source Agency");
  });

  test("renders <ins> as a distinct insertion", () => {
    const parsed = parseMarkdownLine("<s>The Source Agency is</s> <ins>The Source Agencies are</ins>");
    const deleted = parsed.segments.find((segment) => segment.strikethrough);
    const inserted = parsed.segments.find((segment) => segment.underline);
    expect(deleted?.text).toBe("The Source Agency is");
    expect(inserted?.text).toBe("The Source Agencies are");
    expect(inserted?.color).toBeTruthy();
    expect(inserted?.strikethrough).toBeUndefined();
  });

  test("~~strike~~ is strikethrough, not only dim", () => {
    const parsed = parseMarkdownLine("keep ~~gone~~ rest");
    expect(parsed.segments.find((segment) => segment.strikethrough)?.text).toBe("gone");
  });

  test("triple asterisks are bold italic, not leftover stars", () => {
    const parsed = parseMarkdownLine("***KalshiEX LLC***");
    expect(rendered("***KalshiEX LLC***")).toBe("KalshiEX LLC");
    expect(parsed.segments[0]!.bold).toBe(true);
    expect(parsed.segments[0]!.italic).toBe(true);
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
