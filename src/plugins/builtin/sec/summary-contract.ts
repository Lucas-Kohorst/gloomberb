import type { SecFilingItem } from "../../../types/data-provider";

/**
 * Red-flag phrases that signal elevated risk in SEC filings. Detection is
 * keyword-based and case-insensitive so it is deterministic and testable
 * independent of the AI provider.
 */
export const SEC_REDFLAG_KEYWORDS: readonly string[] = [
  "going concern",
  "material weakness",
  "restatement",
  "restated",
  "substantial doubt",
  "remediation",
  "deficiency in internal control",
  "adverse opinion",
  "qualified opinion",
  "going-concern",
  "chapter 11",
  "bankruptcy",
  "impairment charge",
  "significant deficiency",
];

export interface FilingSummary {
  /** Three-sentence executive summary. */
  executiveSummary: string;
  /** Bullet-point risk factors. */
  riskFactors: string[];
  /** Notable changes from the prior comparable filing, when available. */
  notableChanges: string | null;
  /** Red-flag keywords detected in the filing content. */
  redFlags: string[];
  generatedAt: number;
  providerId: string;
  modelId?: string;
}

/** Max filing text length sent to the AI to keep prompts bounded. */
export const SEC_SUMMARY_CONTENT_LIMIT = 12_000;

const REDFLAG_RE = new RegExp(
  SEC_REDFLAG_KEYWORDS.map((keyword) => escapeRegExp(keyword)).join("|"),
  "i",
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scans filing text for red-flag keywords. Returns the matched keywords in
 * first-occurrence order, de-duplicated case-insensitively.
 */
export function detectRedFlags(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const keyword of SEC_REDFLAG_KEYWORDS) {
    const normalized = keyword.toLowerCase();
    if (seen.has(normalized)) continue;
    if (lower.includes(normalized)) {
      seen.add(normalized);
      matches.push(keyword);
    }
  }
  return matches;
}

export function hasRedFlag(text: string): boolean {
  return REDFLAG_RE.test(text);
}

function filingLabel(filing: SecFilingItem): string {
  const entity = filing.companyName || filing.ticker || filing.cik;
  return [entity, filing.form, filing.accessionNumber].filter(Boolean).join(" ");
}

function truncateContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= SEC_SUMMARY_CONTENT_LIMIT) return trimmed;
  return `${trimmed.slice(0, SEC_SUMMARY_CONTENT_LIMIT)}\n[...truncated...]`;
}

export interface BuildSummaryPromptArgs {
  filing: SecFilingItem;
  content: string;
  /** Readable text from the prior comparable filing, when available. */
  priorContent?: string | null;
  /** Optional prior filing metadata for context. */
  priorFiling?: SecFilingItem | null;
}

/**
 * Builds the prompt sent to the default AI provider to summarize a filing.
 * Asks for a structured JSON response so the result can be parsed reliably.
 */
export function buildFilingSummaryPrompt({
  filing,
  content,
  priorContent,
  priorFiling,
}: BuildSummaryPromptArgs): string {
  const lines: string[] = [
    `Summarize this SEC filing (${filingLabel(filing)}).`,
    "",
    "Return a JSON object with these fields:",
    '- "executiveSummary": a concise 3-sentence executive summary of the filing.',
    '- "riskFactors": an array of short bullet strings listing the key risk factors disclosed.',
    '- "notableChanges": a short paragraph of notable changes versus the prior comparable filing, or null when no prior filing is provided or no changes are material.',
    "",
    "Guidelines:",
    "- Base every statement on the filing text provided. Do not invent facts.",
    "- Keep the executive summary to exactly three sentences.",
    "- Keep each risk factor to a single short sentence.",
    '- Output only the JSON object, no markdown fences or commentary.',
    "",
  ];

  if (priorContent?.trim() && priorFiling) {
    lines.push(
      "Prior comparable filing for change analysis:",
      filingLabel(priorFiling),
      truncateContent(priorContent),
      "",
    );
  } else {
    lines.push("No prior comparable filing content was provided; set notableChanges to null.", "");
  }

  lines.push("Filing content:", truncateContent(content));
  return lines.join("\n");
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fence) candidates.push(fence);
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter((entry) => entry.length > 0);
}

/**
 * Parses the AI response into a FilingSummary body (without red flags, which
 * are detected locally). Throws when the response is not usable.
 */
export function parseFilingSummaryResponse(raw: string): {
  executiveSummary: string;
  riskFactors: string[];
  notableChanges: string | null;
} {
  const parsed = tryParseJson(raw);
  if (parsed && typeof parsed === "object") {
    const payload = parsed as Record<string, unknown>;
    const executiveSummary = normalizeString(payload.executiveSummary);
    if (!executiveSummary) {
      throw new Error("AI summary did not include an executive summary.");
    }
    return {
      executiveSummary,
      riskFactors: normalizeStringArray(payload.riskFactors),
      notableChanges: normalizeString(payload.notableChanges) || null,
    };
  }

  // Fallback: treat the whole response as a single-block summary.
  const fallback = normalizeString(raw);
  if (!fallback) {
    throw new Error("AI summary response was empty.");
  }
  return {
    executiveSummary: fallback,
    riskFactors: [],
    notableChanges: null,
  };
}

/**
 * Renders a FilingSummary as a plain-text block suitable for appending to a
 * filing detail body.
 */
export function renderFilingSummary(summary: FilingSummary): string {
  const lines: string[] = ["AI Summary", ""];
  lines.push(summary.executiveSummary);
  if (summary.riskFactors.length > 0) {
    lines.push("", "Key Risk Factors");
    for (const risk of summary.riskFactors) lines.push(`• ${risk}`);
  }
  if (summary.notableChanges) {
    lines.push("", "Notable Changes", summary.notableChanges);
  }
  if (summary.redFlags.length > 0) {
    lines.push("", "Red Flags");
    for (const flag of summary.redFlags) lines.push(`! ${flag}`);
  }
  return lines.join("\n");
}

/**
 * Finds the most recent prior filing of the same form (excluding amendments)
 * to use as a comparison baseline. Returns null when none is available.
 */
export function findPriorComparableFiling(
  filings: readonly SecFilingItem[],
  current: SecFilingItem,
): SecFilingItem | null {
  const form = current.form.trim().toUpperCase();
  let best: SecFilingItem | null = null;
  for (const filing of filings) {
    if (filing.accessionNumber === current.accessionNumber) continue;
    if (filing.form.trim().toUpperCase() !== form) continue;
    if (filing.filingDate >= current.filingDate) continue;
    // Callers pass EDGAR pages that are usually newest-first but not
    // guaranteed to be, so pick the latest by date instead of the first hit.
    if (!best || filing.filingDate > best.filingDate) best = filing;
  }
  return best;
}
