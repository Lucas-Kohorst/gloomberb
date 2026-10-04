import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import {
  severityTag,
  type CommentLetter,
  type CommentLetterFiling,
  type CommentLetterRow,
  type CommentLetterSeverity,
  type SeverityAssessment,
} from "./types";

const EFTS_URL = "https://efts.sec.gov/LATEST/search-index";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_COUNT = 50;

const COMMENT_LETTER_FORM_SET = new Set(["CORRESP", "UPLOAD"]);

const readEnv = (name: string): string | undefined => {
  const value = typeof process !== "undefined" ? process.env[name]?.trim() : undefined;
  return value || undefined;
};

// EDGAR rejects a User-Agent that does not name a contact.
const secContact = (): string =>
  readEnv("SEC_EDGAR_EMAIL") || readEnv("SEC_FROM_EMAIL") || "gloomberb@localhost.local";

const secHeaders = (): Record<string, string> => {
  const from = secContact();
  return {
    "User-Agent": readEnv("SEC_USER_AGENT") || `Gloomberb/0.1 (comment-letters; contact=${from})`,
    From: from,
    Accept: "application/json,text/plain,*/*",
    Referer: "https://www.sec.gov/",
  };
};

const lettersFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: FETCH_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: secHeaders(),
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

/** True for the EDGAR informal-correspondence forms (case/whitespace tolerant). */
export const isCommentLetterForm = (form: string | undefined): boolean => {
  if (!form) return false;
  return COMMENT_LETTER_FORM_SET.has(form.trim().toUpperCase());
};

/** Keep only CORRESP/UPLOAD filings from a mixed EDGAR result set. */
export const filterCommentLetters = <T extends { form: string }>(filings: T[]): T[] =>
  filings.filter((filing) => isCommentLetterForm(filing.form));

// Keyword weights, not a legal read: a hit means open this letter first.
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

/** Classify one letter's text. Empty text scores 0 (low) and never throws. */
export const classifySeverity = (text: string | null | undefined): SeverityAssessment => {
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
    if (reasons.length === 0) reasons.push(body.trim() ? "no flagged topics" : "no text");
  }

  const level: CommentLetterSeverity = score >= HIGH_THRESHOLD
    ? "high"
    : score >= MEDIUM_THRESHOLD
      ? "medium"
      : "low";
  return { level, score, reasons };
};

const bumpSeverity = (level: CommentLetterSeverity): CommentLetterSeverity => {
  if (level === "low") return "medium";
  if (level === "medium") return "high";
  return "high";
};

// A third round means the staff was not satisfied; bump the worst letter once.
export const classifyConversation = (texts: Array<string | null | undefined>): SeverityAssessment => {
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
};

const metadataText = (filing: CommentLetterFiling): string =>
  [filing.form, filing.primaryDocDescription, filing.items, filing.companyName].filter(Boolean).join(" ");

export const toCommentLetter = (filing: CommentLetterFiling): CommentLetter => {
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
};

const companyLabel = (letter: CommentLetter): string => {
  const name = letter.companyName?.trim() || letter.cik;
  return letter.ticker ? `${name} (${letter.ticker})` : name;
};

export const toCommentLetterRow = (letter: CommentLetter): CommentLetterRow => {
  const filedAt = letter.filingDate.getTime();
  const filed = Number.isNaN(filedAt) || filedAt === 0 ? "" : letter.filingDate.toISOString().slice(0, 10);
  return {
    id: letter.id,
    form: letter.form,
    company: companyLabel(letter),
    ticker: letter.ticker ?? "",
    cik: letter.cik,
    filed,
    filedAt: Number.isNaN(filedAt) ? 0 : filedAt,
    severity: letter.severity,
    severityLabel: severityTag(letter.severity),
    score: letter.severityScore,
    topic: letter.description?.trim() ?? "",
    reasons: letter.severityReasons,
    url: letter.primaryDocumentUrl || letter.filingUrl || null,
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const zeroPadCik = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(10, "0");
};

const parseDate = (value: unknown): Date | undefined => {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return new Date(`${text}T00:00:00Z`);
};

const parseDisplayName = (value: string): { companyName?: string; ticker?: string } => {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const withTicker = trimmed.match(/^(.*?)\s+\(([A-Z0-9][A-Z0-9.\-]{0,9})\)\s+\(CIK\s+\d+\)\s*$/i);
  if (withTicker?.[1] && withTicker[2]) {
    return { companyName: withTicker[1].trim() || undefined, ticker: withTicker[2].toUpperCase() };
  }
  const nameOnly = trimmed.match(/^(.*?)\s+\(CIK\s+\d+\)\s*$/i);
  if (nameOnly?.[1]) return { companyName: nameOnly[1].trim() || undefined };
  return { companyName: trimmed };
};

const parseEftsFilings = (payload: unknown, count = DEFAULT_COUNT): CommentLetterFiling[] => {
  const record = asRecord(payload);
  const hits = asRecord(record?.hits);
  const rows = Array.isArray(hits?.hits) ? hits.hits : [];
  const results: CommentLetterFiling[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (results.length >= Math.max(count, 0)) break;
    const hit = asRecord(row);
    const source = asRecord(hit?._source);
    if (!hit || !source) continue;

    const hitId = String(hit._id ?? "").trim();
    const accessionNumber = String(source.adsh ?? hitId.split(":")[0] ?? "").trim();
    const form = String(
      (Array.isArray(source.form) ? source.form[0] : source.form)
      ?? (Array.isArray(source.root_forms) ? source.root_forms[0] : source.root_forms)
      ?? "",
    ).trim();
    const filingDate = parseDate(source.file_date);
    const ciks = Array.isArray(source.ciks) ? source.ciks : [];
    const cik = zeroPadCik(ciks[0] ?? source.cik) ?? "";
    const displayCik = String(Number(cik || "0"));
    if (!accessionNumber || !form || !filingDate || !displayCik) continue;
    if (seen.has(accessionNumber)) continue;
    seen.add(accessionNumber);

    const primaryDocument = hitId.includes(":")
      ? hitId.slice(hitId.indexOf(":") + 1).trim() || undefined
      : undefined;
    const displayName = Array.isArray(source.display_names)
      ? String(source.display_names[0] ?? "")
      : String(source.display_names ?? "");
    const identity = parseDisplayName(displayName);
    const items = Array.isArray(source.items)
      ? source.items.map((item) => String(item).trim()).filter(Boolean).join(",")
      : String(source.items ?? "").trim();
    const accessionNumberNoDashes = accessionNumber.replace(/-/g, "");

    results.push({
      accessionNumber,
      form,
      filingDate,
      primaryDocDescription: String(source.file_description ?? "").trim() || undefined,
      items: items || undefined,
      cik,
      companyName: identity.companyName,
      ticker: identity.ticker,
      filingUrl: `https://www.sec.gov/Archives/edgar/data/${displayCik}/${accessionNumber}-index.htm`,
      primaryDocumentUrl: primaryDocument
        ? `https://www.sec.gov/Archives/edgar/data/${displayCik}/${accessionNumberNoDashes}/${primaryDocument}`
        : undefined,
    });
  }

  return results;
};

/** Parse a raw EFTS search-index payload into comment letters. Pure: no network. */
const parseCommentLettersPayload = (payload: unknown, count = DEFAULT_COUNT): CommentLetter[] =>
  filterCommentLetters(parseEftsFilings(payload, count)).map(toCommentLetter);

/** The rows a fixture or a live payload becomes, with other EDGAR forms dropped. */
export const commentLetterRowsFromPayload = (payload: unknown, count = DEFAULT_COUNT): CommentLetterRow[] =>
  parseCommentLettersPayload(payload, count).map(toCommentLetterRow);

export const buildCommentLettersUrl = (query: string, count: number): string => {
  const url = new URL(EFTS_URL);
  const trimmed = query.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  url.searchParams.set("forms", "CORRESP,UPLOAD");
  url.searchParams.set("dateRange", "all");
  url.searchParams.set("from", "0");
  url.searchParams.set("size", String(Math.max(1, Math.min(count, 100))));
  return url.toString();
};

interface ListCommentLettersOptions {
  query?: string;
  count?: number;
  signal?: AbortSignal;
}

export class CommentLettersClient {
  /** List CORRESP/UPLOAD filings from the public EDGAR full-text search. No API key. */
  async listCommentLetters(options: ListCommentLettersOptions = {}): Promise<CommentLetter[]> {
    const { query = "", count = DEFAULT_COUNT, signal } = options;
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const response = await lettersFetch.fetch(buildCommentLettersUrl(query, count), {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      throw new Error(`SEC comment-letter search failed (${response.status})`);
    }
    return parseCommentLettersPayload(await response.json(), count);
  }
}
