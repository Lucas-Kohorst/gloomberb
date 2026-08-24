import { describe, expect, test } from "bun:test";
import type { SecFilingItem } from "../../../types/data-provider";
import {
  buildFilingSummaryPrompt,
  detectRedFlags,
  findPriorComparableFiling,
  hasRedFlag,
  parseFilingSummaryResponse,
  renderFilingSummary,
  SEC_REDFLAG_KEYWORDS,
  SEC_SUMMARY_CONTENT_LIMIT,
  type FilingSummary,
} from "./summary-contract";

function filing(accessionNumber: string, form = "10-K", date = "2026-01-01"): SecFilingItem {
  return {
    accessionNumber,
    form,
    filingDate: new Date(date) as unknown as Date,
    cik: "0001234567",
    companyName: "Test Corp",
    ticker: "TEST",
    filingUrl: `https://example.com/${accessionNumber}`,
    primaryDocument: "filing.htm",
  };
}

describe("detectRedFlags", () => {
  test("returns matched keywords in first-occurrence order, de-duplicated", () => {
    const text = "The audit raised a going concern. A material weakness was noted, plus another MATERIAL WEAKNESS.";
    expect(detectRedFlags(text)).toEqual(["going concern", "material weakness"]);
  });

  test("returns an empty list when no keywords are present", () => {
    expect(detectRedFlags("Everything looks great.")).toEqual([]);
  });

  test("treats empty input as no flags", () => {
    expect(detectRedFlags("")).toEqual([]);
  });

  test("hasRedFlag mirrors detectRedFlags", () => {
    expect(hasRedFlag("restatement of prior results")).toBe(true);
    expect(hasRedFlag("all good")).toBe(false);
  });

  test("covers the canonical red-flag phrases", () => {
    for (const keyword of SEC_REDFLAG_KEYWORDS) {
      expect(detectRedFlags(keyword)).toContain(keyword);
    }
  });
});

describe("buildFilingSummaryPrompt", () => {
  test("includes the filing label and content, and asks for JSON", () => {
    const prompt = buildFilingSummaryPrompt({ filing: filing("A1"), content: "Filing body text." });
    expect(prompt).toContain("Test Corp");
    expect(prompt).toContain("Filing body text.");
    expect(prompt).toContain("executiveSummary");
    expect(prompt).toContain("riskFactors");
    expect(prompt).toContain("notableChanges");
  });

  test("omits prior content section when no prior filing is provided", () => {
    const prompt = buildFilingSummaryPrompt({ filing: filing("A1"), content: "body" });
    expect(prompt).toContain("No prior comparable filing content was provided");
  });

  test("includes prior filing label and content when provided", () => {
    const prior = filing("A0", "10-K", "2025-01-01");
    const prompt = buildFilingSummaryPrompt({
      filing: filing("A1"),
      content: "current body",
      priorContent: "prior body",
      priorFiling: prior,
    });
    expect(prompt).toContain("Prior comparable filing for change analysis:");
    expect(prompt).toContain("prior body");
  });

  test("truncates very long content to the limit", () => {
    const long = "x".repeat(SEC_SUMMARY_CONTENT_LIMIT + 5000);
    const prompt = buildFilingSummaryPrompt({ filing: filing("A1"), content: long });
    expect(prompt.length).toBeLessThan(long.length);
    expect(prompt).toContain("[...truncated...]");
  });
});

describe("parseFilingSummaryResponse", () => {
  test("parses a clean JSON object", () => {
    const raw = JSON.stringify({
      executiveSummary: "Sentence one. Sentence two. Sentence three.",
      riskFactors: ["Risk A.", "Risk B."],
      notableChanges: "Changed X.",
    });
    const parsed = parseFilingSummaryResponse(raw);
    expect(parsed.executiveSummary).toBe("Sentence one. Sentence two. Sentence three.");
    expect(parsed.riskFactors).toEqual(["Risk A.", "Risk B."]);
    expect(parsed.notableChanges).toBe("Changed X.");
  });

  test("parses JSON wrapped in a markdown fence", () => {
    const raw = "```json\n" + JSON.stringify({
      executiveSummary: "Sum.",
      riskFactors: [],
      notableChanges: null,
    }) + "\n```";
    expect(parseFilingSummaryResponse(raw).executiveSummary).toBe("Sum.");
  });

  test("parses JSON embedded in surrounding prose", () => {
    const raw = `Here is the summary: {"executiveSummary":"Embedded.","riskFactors":[],"notableChanges":null} thanks`;
    expect(parseFilingSummaryResponse(raw).executiveSummary).toBe("Embedded.");
  });

  test("treats notableChanges null as null and filters empty risk strings", () => {
    const raw = JSON.stringify({
      executiveSummary: "S.",
      riskFactors: ["", "  ", "Real risk."],
      notableChanges: null,
    });
    const parsed = parseFilingSummaryResponse(raw);
    expect(parsed.riskFactors).toEqual(["Real risk."]);
    expect(parsed.notableChanges).toBeNull();
  });

  test("falls back to the raw text as executive summary when not JSON", () => {
    const parsed = parseFilingSummaryResponse("Just a plain summary.");
    expect(parsed.executiveSummary).toBe("Just a plain summary.");
    expect(parsed.riskFactors).toEqual([]);
  });

  test("throws when the executive summary is missing", () => {
    expect(() => parseFilingSummaryResponse(JSON.stringify({ riskFactors: [] }))).toThrow(/executive summary/i);
  });

  test("throws on empty response", () => {
    expect(() => parseFilingSummaryResponse("   ")).toThrow(/empty/i);
  });
});

describe("renderFilingSummary", () => {
  test("renders all sections when present", () => {
    const summary: FilingSummary = {
      executiveSummary: "S1. S2. S3.",
      riskFactors: ["Risk A.", "Risk B."],
      notableChanges: "Changed X.",
      redFlags: ["going concern", "restatement"],
      generatedAt: 1000,
      providerId: "anthropic",
      modelId: "claude",
    };
    const out = renderFilingSummary(summary);
    expect(out).toContain("AI Summary");
    expect(out).toContain("S1. S2. S3.");
    expect(out).toContain("Key Risk Factors");
    expect(out).toContain("• Risk A.");
    expect(out).toContain("Notable Changes");
    expect(out).toContain("Changed X.");
    expect(out).toContain("Red Flags");
    expect(out).toContain("! going concern");
  });

  test("omits empty sections", () => {
    const summary: FilingSummary = {
      executiveSummary: "S1. S2. S3.",
      riskFactors: [],
      notableChanges: null,
      redFlags: [],
      generatedAt: 1000,
      providerId: "anthropic",
    };
    const out = renderFilingSummary(summary);
    expect(out).not.toContain("Key Risk Factors");
    expect(out).not.toContain("Notable Changes");
    expect(out).not.toContain("Red Flags");
  });
});

describe("findPriorComparableFiling", () => {
  test("returns the most recent earlier filing of the same form", () => {
    const current = filing("A2", "10-K", "2026-01-01");
    const older = filing("A0", "10-K", "2024-01-01");
    const middle = filing("A1", "10-K", "2025-01-01");
    const other = filing("B1", "10-Q", "2025-06-01");
    expect(findPriorComparableFiling([current, older, middle, other], current)).toBe(middle);
  });

  test("returns null when no earlier same-form filing exists", () => {
    const current = filing("A1", "8-K", "2026-01-01");
    const other = filing("A0", "10-K", "2025-01-01");
    expect(findPriorComparableFiling([current, other], current)).toBeNull();
  });

  test("skips the current filing itself", () => {
    const current = filing("A1", "10-K", "2026-01-01");
    expect(findPriorComparableFiling([current], current)).toBeNull();
  });
});
