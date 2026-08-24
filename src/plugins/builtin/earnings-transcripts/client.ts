/**
 * Client for fetching earnings transcript data.
 *
 * Data source: SEC EDGAR (free, keyless). We fetch 8-K filings for a ticker
 * (the "Results of Operations" announcements that accompany earnings calls),
 * then extract the readable content from the primary document. This is a
 * proxy for a real transcript API — the 8-K press release carries the
 * headline numbers and prepared remarks, but not the Q&A portion.
 *
 * TODO: Replace with a dedicated earnings call transcript API
 * (Financial Datasets, Alpha Vantage, or similar) when an API key
 * pipeline is available. The EarningsTranscript type is shaped to accept
 * either source.
 */

import { SecEdgarClient } from "../../../sources/sec-edgar";
import type { SecFilingItem } from "../../../types/data-provider";
import { withConnectionRequest } from "../connections/register";
import type { EarningsTranscript, TranscriptParticipant, TranscriptSection } from "./types";

const CONNECTION_ID = "earnings-transcripts";
const EARNINGS_FORMS = new Set(["8-K", "10-Q", "10-K", "8-K/A", "10-Q/A", "10-K/A"]);
const FETCH_LIMIT = 20;
const FETCH_COUNT_FOR_FILTER = 40;

const secClient = new SecEdgarClient();

/**
 * Filter filings to earnings-related forms (8-K results announcements,
 * 10-Q quarterly reports, 10-K annual reports).
 */
function isEarningsFiling(filing: SecFilingItem): boolean {
  return EARNINGS_FORMS.has(filing.form.trim());
}

/**
 * Extract a quarter label from a filing's items or form.
 * 8-Ks with item 2.02 (Results of Operations) are earnings announcements.
 */
function deriveQuarter(filing: SecFilingItem): string | undefined {
  const date = filing.filingDate;
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  // Approximate fiscal quarter from calendar month.
  const q = Math.ceil(month / 3);
  return `Q${q} FY${year}`;
}

function deriveFiscalYear(filing: SecFilingItem): number | undefined {
  const date = filing.filingDate;
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  return date.getFullYear();
}

function formatFilingDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parse participant names from filing content. In a real transcript API this
 * would be a structured list. From 8-K content we attempt to extract names
 * from common patterns (CEO, CFO, etc.); if none are found, returns empty.
 */
function extractParticipants(body: string): TranscriptParticipant[] {
  const participants: TranscriptParticipant[] = [];
  const seen = new Set<string>();
  // Match common executive titles near names in press release headers.
  const titlePattern =
    /\b(Chief Executive Officer|CEO|Chief Financial Officer|CFO|Chief Operating Officer|COO|President|Chairman|Vice President|VP|Treasurer|Controller|Investor Relations|IR)\b/i;
  // Look for lines with "Name, Title" or "Name - Title" patterns.
  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 5 || trimmed.length > 120) continue;
    const titleMatch = trimmed.match(titlePattern);
    if (!titleMatch) continue;
    // Try to extract a name before the title.
    const beforeTitle = trimmed.slice(0, titleMatch.index ?? 0).trim();
    const name = beforeTitle
      .replace(/[,;:|\-–—]+$/g, "")
      .replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+/i, "")
      .trim();
    if (name.length < 3 || name.length > 60) continue;
    const key = `${name.toLowerCase()}:${titleMatch[0].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push({ name, role: titleMatch[0] });
  }
  return participants.slice(0, 12);
}

/**
 * Split filing body into sections (prepared remarks, etc.).
 * For 8-K content, sections are paragraph-level blocks.
 */
function extractSections(body: string): TranscriptSection[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);
  return paragraphs.slice(0, 8).map((text) => ({
    speaker: "Company",
    text,
  }));
}

/**
 * Build a transcript object from a filing and its extracted content.
 */
function buildTranscript(
  filing: SecFilingItem,
  content: string | null,
): EarningsTranscript {
  const body = content ?? "Filing content was not available for this document.";
  const form = filing.form.trim();
  const titleParts = [
    filing.ticker ?? filing.companyName,
    form,
    deriveQuarter(filing),
  ].filter(Boolean);
  return {
    id: filing.accessionNumber,
    symbol: filing.ticker ?? "",
    company: filing.companyName,
    date: filing.filingDate ? formatFilingDate(filing.filingDate) : "",
    form,
    quarter: deriveQuarter(filing),
    fiscalYear: deriveFiscalYear(filing),
    participants: extractParticipants(body),
    sections: extractSections(body),
    body,
    url: filing.filingUrl,
    title: titleParts.join(" | "),
  };
}

/**
 * Fetch earnings-related filings (8-K, 10-Q, 10-K) for a ticker and extract
 * their content as transcript proxies.
 */
export async function fetchEarningsTranscripts(symbol: string): Promise<EarningsTranscript[]> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return [];

  return withConnectionRequest(CONNECTION_ID, "fetch", async () => {
    // getRecentFilings returns the most recent filings across all forms.
    const allFilings = await secClient.getRecentFilings(normalized, FETCH_COUNT_FOR_FILTER);
    const earningsFilings = allFilings.filter(isEarningsFiling).slice(0, FETCH_LIMIT);

    // Fetch content for each earnings filing in parallel.
    const results = await Promise.allSettled(
      earningsFilings.map(async (filing) => {
        const content = await secClient.getFilingContent(filing);
        return buildTranscript(filing, content);
      }),
    );

    return results
      .filter(
        (r): r is PromiseFulfilledResult<EarningsTranscript> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);
  });
}
