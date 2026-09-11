import { describe, expect, test } from "bun:test";
import type { SecFilingItem } from "../../../types/data-provider";
import {
  diffLines,
  extractFilingSection,
  normalizeDiffLine,
  parseYearSetting,
  pickTenKByYear,
  splitIntoLines,
  tenKYears,
} from "./client";

const filing = (form: string, filingDate: string, accessionNumber: string): SecFilingItem => ({
  accessionNumber,
  form,
  filingDate: new Date(filingDate),
  cik: "320193",
  companyName: "Apple Inc.",
  ticker: "AAPL",
  filingUrl: `https://www.sec.gov/Archives/edgar/data/320193/${accessionNumber}/aapl.htm`,
});

const RISK_FIXTURE = [
  "ITEM 1A. RISK FACTORS",
  "Our business is subject to intense competition.",
  "We depend on a single supplier for key components.",
  "ITEM 1B. UNRESOLVED STAFF COMMENTS",
  "None.",
].join("\n");

const MDA_FIXTURE = [
  "ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS",
  "Revenue grew 5% driven by services.",
  "ITEM 7A. QUANTITATIVE DISCLOSURES",
  "Market risk is minimal.",
].join("\n");

describe("splitIntoLines", () => {
  test("splits, trims, and drops blanks", () => {
    expect(splitIntoLines("  alpha  \n\nbeta\r\n   \ngamma ")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  test("empty text yields no lines", () => {
    expect(splitIntoLines("   \n  ")).toEqual([]);
  });
});

describe("normalizeDiffLine", () => {
  test("collapses interior whitespace", () => {
    expect(normalizeDiffLine("  Revenue   grew   5%  ")).toBe("Revenue grew 5%");
  });
});

describe("diffLines", () => {
  test("identical input is all unchanged", () => {
    const result = diffLines(["a", "b"], ["a", "b"]);
    expect(result).toEqual([
      { type: "unchanged", text: "a" },
      { type: "unchanged", text: "b" },
    ]);
  });

  test("detects an added line in place", () => {
    const result = diffLines(["a", "c"], ["a", "b", "c"]);
    expect(result).toEqual([
      { type: "unchanged", text: "a" },
      { type: "added", text: "b" },
      { type: "unchanged", text: "c" },
    ]);
  });

  test("detects a removed line in place", () => {
    const result = diffLines(["a", "b", "c"], ["a", "c"]);
    expect(result).toEqual([
      { type: "unchanged", text: "a" },
      { type: "removed", text: "b" },
      { type: "unchanged", text: "c" },
    ]);
  });

  test("orders a substitution as removed then added", () => {
    const result = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    expect(result).toEqual([
      { type: "unchanged", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "x" },
      { type: "unchanged", text: "c" },
    ]);
  });

  test("empty sides produce pure add or remove scripts", () => {
    expect(diffLines([], ["a"])).toEqual([{ type: "added", text: "a" }]);
    expect(diffLines(["a"], [])).toEqual([{ type: "removed", text: "a" }]);
    expect(diffLines([], [])).toEqual([]);
  });

  test("treats whitespace-only differences as unchanged", () => {
    const result = diffLines(["Revenue   grew 5%"], ["Revenue grew 5%"]);
    expect(result).toEqual([{ type: "unchanged", text: "Revenue grew 5%" }]);
  });
});

describe("extractFilingSection", () => {
  test("slices risk factors between item 1a and 1b", () => {
    const section = extractFilingSection(RISK_FIXTURE, "risk-factors");
    expect(section).toContain("intense competition");
    expect(section).toContain("single supplier");
    expect(section).not.toContain("UNRESOLVED STAFF COMMENTS");
    expect(section).not.toContain("ITEM 1A");
  });

  test("slices mda between item 7 and 7a", () => {
    const section = extractFilingSection(MDA_FIXTURE, "mda");
    expect(section).toContain("Revenue grew 5%");
    expect(section).not.toContain("QUANTITATIVE");
  });

  test("matches item headers case-insensitively", () => {
    const lower = RISK_FIXTURE.toLowerCase();
    const section = extractFilingSection(lower, "risk-factors");
    expect(section).toContain("intense competition");
  });

  test("falls back to full text when markers are missing", () => {
    const plain = "Plain filing body without item markers.";
    expect(extractFilingSection(plain, "risk-factors")).toBe(plain);
    expect(extractFilingSection(plain, "mda")).toBe(plain);
  });

  test("full section returns trimmed text", () => {
    expect(extractFilingSection(`\n${MDA_FIXTURE}\n\n`, "full")).toBe(MDA_FIXTURE);
  });
});

describe("10-K year picking", () => {
  const filings = [
    filing("10-K", "2024-11-01T00:00:00Z", "0001"),
    filing("10-K", "2023-11-03T00:00:00Z", "0002"),
    filing("10-Q", "2024-08-01T00:00:00Z", "0003"),
  ];

  test("picks the 10-K filed in the requested year", () => {
    expect(pickTenKByYear(filings, 2023)?.accessionNumber).toBe("0002");
    expect(pickTenKByYear(filings, 2024)?.accessionNumber).toBe("0001");
  });

  test("ignores non-10-K forms and missing years", () => {
    expect(pickTenKByYear(filings, 2022)).toBeUndefined();
    expect(tenKYears(filings)).toEqual([2024, 2023]);
  });

  test("parses 4-digit year settings only", () => {
    expect(parseYearSetting("2024")).toBe(2024);
    expect(parseYearSetting(" 2023 ")).toBe(2023);
    expect(parseYearSetting("24")).toBeNull();
    expect(parseYearSetting("")).toBeNull();
    expect(parseYearSetting(undefined)).toBeNull();
  });
});
