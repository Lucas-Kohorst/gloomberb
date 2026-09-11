import { describe, expect, test } from "bun:test";
import type { SecFilingItem } from "../../../types/data-provider";
import {
  buildCommentLettersUrl,
  classifyConversation,
  classifySeverity,
  filterCommentLetters,
  isCommentLetterForm,
  parseCommentLettersPayload,
  toCommentLetter,
} from "./client";
import { severityRank, severityTag } from "./types";

function eftsHit(id: string, form: string, companyName: string, fileDate: string) {
  return {
    _id: id,
    _source: {
      adsh: id.split(":")[0],
      form,
      file_date: fileDate,
      ciks: ["0000320193"],
      display_names: [companyName],
      file_description: "CORRESP correspondence",
    },
  };
}

function eftsPayload(hits: ReturnType<typeof eftsHit>[]) {
  return { hits: { hits: hits } };
}

function filing(overrides: Partial<SecFilingItem> = {}): SecFilingItem {
  return {
    accessionNumber: "0000320193-26-000123",
    form: "CORRESP",
    filingDate: new Date("2026-05-12T00:00:00Z"),
    cik: "320193",
    companyName: "Apple Inc.",
    ticker: "AAPL",
    filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123-index.htm",
    ...overrides,
  };
}

describe("isCommentLetterForm", () => {
  test("matches CORRESP and UPLOAD case-insensitively", () => {
    expect(isCommentLetterForm("CORRESP")).toBe(true);
    expect(isCommentLetterForm("upload")).toBe(true);
    expect(isCommentLetterForm(" Upload ")).toBe(true);
  });

  test("rejects other EDGAR forms", () => {
    expect(isCommentLetterForm("10-K")).toBe(false);
    expect(isCommentLetterForm("8-K")).toBe(false);
    expect(isCommentLetterForm(undefined)).toBe(false);
    expect(isCommentLetterForm("")).toBe(false);
  });
});

describe("filterCommentLetters", () => {
  test("keeps only CORRESP/UPLOAD rows", () => {
    const kept = filterCommentLetters([
      filing({ form: "CORRESP", accessionNumber: "a" }),
      filing({ form: "10-K", accessionNumber: "b" }),
      filing({ form: "UPLOAD", accessionNumber: "c" }),
    ]);
    expect(kept.map((letter) => letter.accessionNumber)).toEqual(["a", "c"]);
  });
});

describe("classifySeverity", () => {
  test("scores high-signal letters high", () => {
    const assessment = classifySeverity(
      "We believe the previously issued financial statements require restatement. " +
        "The company is the subject of an investigation and has received a Wells notice.",
    );
    expect(assessment.level).toBe("high");
    expect(assessment.reasons).toContain("restatement");
    expect(assessment.reasons).toContain("investigation");
  });

  test("scores accounting-topic letters medium", () => {
    const assessment = classifySeverity(
      "Please describe your revenue recognition policy for multi-element arrangements " +
        "and the related fair value measurements.",
    );
    expect(assessment.level).toBe("medium");
  });

  test("scores formatting nits low", () => {
    const assessment = classifySeverity(
      "Please revise the XBRL tagging on the cover page. Formatting only.",
    );
    expect(assessment.level).toBe("low");
  });

  test("never throws on empty text", () => {
    expect(classifySeverity(null).level).toBe("low");
    expect(classifySeverity("").reasons).toEqual(["no text"]);
  });
});

describe("classifyConversation", () => {
  test("keeps the worst single-letter level for short threads", () => {
    const assessment = classifyConversation([
      "Revenue recognition and fair value disclosures.",
      "Internal controls and risk factors.",
    ]);
    expect(assessment.level).toBe("medium");
    expect(assessment.reasons.some((reason) => reason.includes("round"))).toBe(false);
  });

  test("bumps the level when the exchange runs three or more rounds", () => {
    const assessment = classifyConversation([
      "Revenue recognition and fair value disclosures.",
      "Internal controls and risk factors.",
      "Related party and impairment disclosures.",
    ]);
    expect(assessment.level).toBe("high");
    expect(assessment.reasons).toContain("3-round exchange");
  });
});

describe("parseCommentLettersPayload", () => {
  test("parses EFTS hits and keeps only comment-letter forms", () => {
    const letters = parseCommentLettersPayload(
      eftsPayload([
        eftsHit("0000320193-26-000123:aapl-corresp.htm", "CORRESP", "Apple Inc.", "2026-05-12"),
        eftsHit("0000320193-26-000124:aapl-10k.htm", "10-K", "Apple Inc.", "2026-05-13"),
      ]),
    );
    expect(letters).toHaveLength(1);
    expect(letters[0]?.form).toBe("CORRESP");
    expect(letters[0]?.companyName).toBe("Apple Inc.");
    expect(letters[0]?.severity).toBe("low");
  });
});

describe("toCommentLetter", () => {
  test("flags a single high signal in the description as medium", () => {
    const letter = toCommentLetter(
      filing({ primaryDocDescription: "CORRESP re: restatement of previously issued financials" }),
    );
    expect(letter.severity).toBe("medium");
    expect(letter.severityReasons).toContain("restatement");
  });

  test("scores two high signals as high", () => {
    const letter = toCommentLetter(
      filing({ primaryDocDescription: "CORRESP re: restatement and fraud investigation" }),
    );
    expect(letter.severity).toBe("high");
  });

  test("falls back to low severity without description text", () => {
    const letter = toCommentLetter(filing());
    expect(letter.severity).toBe("low");
  });
});

describe("buildCommentLettersUrl", () => {
  test("pins the forms filter and clamps size", () => {
    const url = buildCommentLettersUrl("Apple", 500);
    expect(url).toContain("forms=CORRESP%2CUPLOAD");
    expect(url).toContain("q=Apple");
    expect(url).toContain("size=100");
  });

  test("omits q for blank queries", () => {
    expect(buildCommentLettersUrl("", 50)).not.toContain("q=");
  });
});

describe("severity helpers", () => {
  test("orders low < medium < high", () => {
    expect(severityRank("low")).toBeLessThan(severityRank("medium"));
    expect(severityRank("medium")).toBeLessThan(severityRank("high"));
    expect(severityTag("high")).toBe("HIGH");
    expect(severityTag("medium")).toBe("MED");
    expect(severityTag("low")).toBe("LOW");
  });
});
