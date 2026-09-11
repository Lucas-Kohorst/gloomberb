import {
  SecEdgarClient,
  parseEftsFilings,
} from "../../../sources/sec-edgar";
import type { SecFilingItem } from "../../../types/data-provider";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import {
  COMMENT_LETTERS_CONNECTION_ID,
  type CommentLetter,
  type CommentLetterSeverity,
  type SeverityAssessment,
} from "./types";

const EFTS_URL = "https://efts.sec.gov/LATEST/search-index";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_COUNT = 50;

const COMMENT_LETTER_FORM_SET = new Set(["CORRESP", "UPLOAD"]);

/** True for the EDGAR informal-correspondence forms (case/whitespace tolerant). */
export function isCommentLetterForm(form: string | undefined): boolean {
  if (!form) return false;
  return COMMENT_LETTER_FORM_SET.has(form.trim().toUpperCase());
}

/** Keep only CORRESP/UPLOAD filings from a mixed EDGAR result set. */
export function filterCommentLetters(filings: SecFilingItem[]): SecFilingItem[] {
  return filings.filter((filing) => isCommentLetterForm(filing.form));
}

// ---------------------------------------------------------------------------
// Severity classification.
//
// Heuristic, not legal advice: staff letters that name restatements, fraud,
// enforcement, or going-concern language historically precede harder outcomes
// than XBRL/formatting nits. Weights are intentionally coarse — a keyword
// hit means "read this one first", nothing more.
//
// Two tiers:
// - classifySeverity(text): one document (staff letter or company response).
// - classifyConversation(texts): a whole back-and-forth thread; 3+ rounds
//   bumps the worst single-letter level by one, since a protracted exchange
//   suggests the staff is not satisfied with the first answers.
// ---------------------------------------------------------------------------

const HIGH_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /restate/i, label: "restatement" },
  { pattern: /fraud/i, label: "fraud" },
  { pattern: /investigat/i, label: "investigation" },
  { pattern: /subpoena/i, label: "subpoena" },
  { pattern: /wells\s+notice/i, label: "wells notice" },
  { pattern: /enforcement\s+action/i, label: "enforcement action" },
  { pattern: /going\s+concern/i, label: "going concern" },
  { pattern: /material\s+weakness/i, label: "material weakness" },
  { pattern: /auditor.{0,20}resign/i, label: "auditor resignation" },
  { pattern: /disagree.{0,20}accountant/i, label: "auditor disagreement" },
  { pattern: /delist/i, label: "delisting" },
  { pattern: /whistleblower/i, label: "whistleblower" },
];

const MEDIUM_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /revenue\s+recognition/i, label: "revenue recognition" },
  { pattern: /non-?gaap/i, label: "non-GAAP" },
  { pattern: /segment\s+report/i, label: "segment reporting" },
  { pattern: /impairment/i, label: "impairment" },
  { pattern: /goodwill/i, label: "goodwill" },
  { pattern: /management's\s+discussion|md\s*&\s*a\b/i, label: "MD&A" },
  { pattern: /risk\s+factor/i, label: "risk factors" },
  { pattern: /critical\s+account/i, label: "critical accounting" },
  { pattern: /internal\s+control/i, label: "internal controls" },
  { pattern: /disclosure\s+control/i, label: "disclosure controls" },
  { pattern: /related\s+party/i, label: "related party" },
  { pattern: /fair\s+value/i, label: "fair value" },
  { pattern: /executive\s+compensation/i, label: "executive compensation" },
];

const LOW_ONLY_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /xbrl/i, label: "XBRL" },
  { pattern: /formatting/i, label: "formatting" },
  { pattern: /cover\s+page/i, label: "cover page" },
  { pattern: /signature/i, label: "signature" },
];

const HIGH_WEIGHT = 3;
const MEDIUM_WEIGHT = 1;
const HIGH_THRESHOLD = 6;
const MEDIUM_THRESHOLD = 2;

/** Classify one letter's text. Empty text scores 0 (low) — never throw on it. */
export function classifySeverity(text: string | null | undefined): SeverityAssessment {
  const body = (text ?? "").slice(0, 200_000);
  let score = 0;
  const reasons: string[] = [];

  for (const signal of HIGH_SIGNALS) {
    if (signal.pattern.test(body)) {
      score += HIGH_WEIGHT;
      reasons.push(signal.label);
    }
  }
  for (const signal of MEDIUM_SIGNALS) {
    if (signal.pattern.test(body)) {
      score += MEDIUM_WEIGHT;
      reasons.push(signal.label);
    }
  }
  if (reasons.length === 0) {
    for (const signal of LOW_ONLY_SIGNALS) {
      if (signal.pattern.test(body)) {
        reasons.push(signal.label);
        break;
      }
    }
    if (reasons.length === 0) {
      reasons.push(body.trim() ? "no flagged topics" : "no text");
    }
  }

  const level: CommentLetterSeverity = score >= HIGH_THRESHOLD
    ? "high"
    : score >= MEDIUM_THRESHOLD
      ? "medium"
      : "low";
  return { level, score, reasons };
}

function bumpSeverity(level: CommentLetterSeverity): CommentLetterSeverity {
  if (level === "low") return "medium";
  if (level === "medium") return "high";
  return "high";
}

/**
 * Classify a whole comment-letter thread. The level is the worst single
 * letter, bumped once when the exchange runs 3+ rounds (staff unsatisfied
 * with early answers). Returns the merged assessment with a round-trip note.
 */
export function classifyConversation(texts: Array<string | null | undefined>): SeverityAssessment {
  const assessments = texts.map((text) => classifySeverity(text));
  let worst: SeverityAssessment = { level: "low", score: 0, reasons: ["no text"] };
  for (const assessment of assessments) {
    if (assessment.score > worst.score) worst = assessment;
  }
  if (texts.length >= 3 && worst.level !== "high") {
    return {
      level: bumpSeverity(worst.level),
      score: worst.score,
      reasons: [...worst.reasons, `${texts.length}-round exchange`],
    };
  }
  return worst;
}

/** Metadata text available without fetching the letter body. */
function metadataText(filing: SecFilingItem): string {
  return [filing.form, filing.primaryDocDescription, filing.items, filing.companyName]
    .filter(Boolean)
    .join(" ");
}

export function toCommentLetter(filing: SecFilingItem): CommentLetter {
  const assessment = classifySeverity(metadataText(filing));
  return {
    id: `${filing.accessionNumber}:${filing.form}`,
    form: filing.form.trim().toUpperCase(),
    companyName: filing.companyName,
    ticker: filing.ticker,
    cik: filing.cik,
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    filingUrl: filing.filingUrl,
    primaryDocumentUrl: filing.primaryDocumentUrl,
    description: filing.primaryDocDescription,
    severity: assessment.level,
    severityScore: assessment.score,
    severityReasons: assessment.reasons,
  };
}

/**
 * Parse a raw EFTS search-index payload into comment letters.
 * Pure — the unit tests feed it inline fixtures, no network.
 */
export function parseCommentLettersPayload(payload: unknown, count = DEFAULT_COUNT): CommentLetter[] {
  return filterCommentLetters(parseEftsFilings(payload, count)).map(toCommentLetter);
}

// SEC EDGAR rejects requests whose User-Agent lacks a reachable contact.
// Mirrors the convention in src/sources/sec-edgar.ts on a smaller surface:
// explicit env wins, otherwise a plausible gloomberb contact address.
function secHeaders(): Record<string, string> {
  const from = ((typeof process === "undefined" ? undefined : process.env.SEC_FROM_EMAIL) ?? "").trim() || "gloomberb@localhost.local";
  const userAgent = ((typeof process === "undefined" ? undefined : process.env.SEC_USER_AGENT) ?? "").trim()
    || `Gloomberb/0.1 (comment-letters; contact=${from})`;
  return {
    "User-Agent": userAgent,
    From: from,
    Accept: "application/json,text/plain,*/*",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.sec.gov/",
  };
}

export function buildCommentLettersUrl(query: string, count: number): string {
  const url = new URL(EFTS_URL);
  const trimmed = query.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  url.searchParams.set("forms", "CORRESP,UPLOAD");
  url.searchParams.set("dateRange", "all");
  url.searchParams.set("from", "0");
  url.searchParams.set("size", String(Math.max(1, Math.min(count, 100))));
  return url.toString();
}

export interface ListCommentLettersOptions {
  query?: string;
  count?: number;
  signal?: AbortSignal;
}

export class CommentLettersClient {
  private edgar: SecEdgarClient;

  constructor(edgar?: SecEdgarClient) {
    this.edgar = edgar ?? new SecEdgarClient();
  }

  /**
   * List CORRESP/UPLOAD filings. Listing parses with the shared EDGAR
   * client's `parseEftsFilings` (it owns the EFTS response shape); only the
   * forms-filtered query lives here because SecEdgarClient exposes no
   * form-scoped search of its own.
   */
  async listCommentLetters(options: ListCommentLettersOptions = {}): Promise<CommentLetter[]> {
    const { query = "", count = DEFAULT_COUNT, signal } = options;
    return withConnectionRequest(COMMENT_LETTERS_CONNECTION_ID, "list", async () => {
      const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const combined = signal
        ? AbortSignal.any([signal, timeout])
        : timeout;
      const response = await httpFetch(buildCommentLettersUrl(query, count), {
        headers: secHeaders(),
        signal: combined,
      });
      if (!response.ok) {
        throw new Error(`SEC comment-letter search failed (${response.status})`);
      }
      const payload: unknown = await response.json();
      return parseCommentLettersPayload(payload, count);
    });
  }

  /** Fetch a letter's full text via the shared EDGAR client. */
  async getLetterText(letter: Pick<CommentLetter, "filingUrl" | "primaryDocumentUrl" | "form">): Promise<string | null> {
    return withConnectionRequest(COMMENT_LETTERS_CONNECTION_ID, "fetch-letter", async () => {
      return this.edgar.getFilingContent({
        primaryDocumentUrl: letter.primaryDocumentUrl,
        filingUrl: letter.filingUrl,
        form: letter.form,
      });
    });
  }

  /** Full-text severity for a letter (heavier than the metadata pass at list time). */
  async getLetterAssessment(
    letter: Pick<CommentLetter, "filingUrl" | "primaryDocumentUrl" | "form">,
  ): Promise<SeverityAssessment> {
    const text = await this.getLetterText(letter);
    return classifySeverity(text);
  }

  /** Filing index documents via the shared EDGAR client. */
  async getLetterDocuments(filing: SecFilingItem) {
    return withConnectionRequest(COMMENT_LETTERS_CONNECTION_ID, "fetch-documents", async () => {
      return this.edgar.getFilingDocuments(filing);
    });
  }
}
