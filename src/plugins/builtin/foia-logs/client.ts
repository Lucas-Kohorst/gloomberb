import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import type {
  DocumentSearchHit,
  DocumentSearchProvider,
  SearchDocument,
} from "../../../types/plugin";
import { withConnectionRequest } from "../connections/register";
import {
  FOIA_LOGS_CONNECTION_ID,
  FOIA_LOGS_DEFAULT_B7A_MONTHS,
  FOIA_LOGS_DEFAULT_MONTHS,
  FOIA_LOGS_DISPLAY_CAP,
  SEC_FOIA_BASE_URL,
  SEC_FOIA_LOGS_PAGE_URL,
  type FoiaLogEntry,
  type FoiaLogPage,
  type FoiaSignal,
} from "./types";

export const FOIA_B7A_RESULT_LIMIT = 5;

const foiaFetch = createThrottledFetch({
  requestsPerMinute: 10,
  maxRetries: 1,
  timeoutMs: 20_000,
  backoffBaseMs: 1000,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "text/html, text/csv, */*",
    "User-Agent": "gloomberb-foia-logs",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

// ---------------------------------------------------------------------------
// CSV parsing (dependency-free RFC 4180: quoted fields, escaped quotes, CRLF)
// ---------------------------------------------------------------------------

/** Split CSV text into rows of fields. Never throws on malformed input. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let hasField = false;
  const pushField = () => {
    row.push(field);
    field = "";
    hasField = false;
  };
  const pushRow = () => {
    pushField();
    // Skip fully-blank lines (a lone trailing newline yields [""]).
    if (!(row.length === 1 && row[0]!.trim() === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      hasField = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRow();
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
      hasField = true;
    }
  }
  if (hasField || field !== "" || row.length > 0) pushRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Header mapping: SEC column names vary slightly across months, so headers
// are normalized (lowercased, non-alphanumerics stripped) and matched
// against alias lists. First alias hit wins; unknown columns are ignored.
// ---------------------------------------------------------------------------

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<string, string[]> = {
  requestId: [
    "requestid",
    "requestnumber",
    "requestidentificationnumber",
    "trackingnumber",
    "controlnumber",
    "foiarequestid",
    "id",
  ],
  requesterName: ["requestername", "requestorname", "requester", "requestor", "name"],
  requesterOrganization: [
    "requesterorganization",
    "requestororganization",
    "organization",
    "requesterorg",
    "company",
  ],
  feeCategory: ["requesterfeecategory", "feecategory", "category", "feecat"],
  description: [
    "requestdescription",
    "description",
    "descriptionofrecordsrequested",
    "recordssought",
    "subject",
    "requestsubject",
    "detailsofrequest",
    "summary",
  ],
  dateOfRequest: ["dateofrequest", "requestdate", "daterequested"],
  dateReceived: ["dateofreceipt", "datereceived", "receiveddate", "receiptdate"],
  status: ["requeststatus", "status"],
  closedDate: ["closeddate", "dateclosed", "completiondate", "closed", "datecompleted"],
  disposition: ["finaldisposition", "disposition", "determination", "outcome", "result"],
};

function mapHeaderIndexes(header: string[]): Record<string, number> {
  const indexes: Record<string, number> = {};
  const normalized = header.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx >= 0) {
        indexes[field] = idx;
        break;
      }
    }
  }
  return indexes;
}

function asDate(value: string): Date {
  const trimmed = value.trim();
  if (!trimmed) return new Date(0);
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** Parse one monthly log CSV into entries. Never throws; skips blank rows. */
export function parseFoiaLogCsv(
  csvText: string,
  source: { sourceMonth: string; fromB7AFile: boolean; url: string },
): FoiaLogEntry[] {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];
  const indexes = mapHeaderIndexes(rows[0]!);
  const cell = (row: string[], field: string): string => {
    const idx = indexes[field];
    return idx == null ? "" : (row[idx] ?? "").trim();
  };
  const entries: FoiaLogEntry[] = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const requestId = cell(row, "requestId");
    const description = cell(row, "description");
    if (!requestId && !description) return;
    const entry: FoiaLogEntry = {
      id: `${source.sourceMonth}::${requestId || `row-${rowIndex + 1}`}`,
      requestId: requestId || `row-${rowIndex + 1}`,
      requesterName: cell(row, "requesterName"),
      requesterOrganization: cell(row, "requesterOrganization"),
      feeCategory: cell(row, "feeCategory"),
      description,
      dateOfRequest: asDate(cell(row, "dateOfRequest")),
      dateReceived: asDate(cell(row, "dateReceived")),
      status: cell(row, "status"),
      closedDate: asDate(cell(row, "closedDate")),
      disposition: cell(row, "disposition"),
      fromB7AFile: source.fromB7AFile,
      sourceMonth: source.sourceMonth,
      url: source.url,
      signal: "watch",
      matchReason: "",
    };
    entry.signal = classifySignal(entry);
    entries.push(entry);
  });
  return entries;
}

// ---------------------------------------------------------------------------
// Index discovery: the SEC posts no log API, so CSV links are scraped from
// the FOIA logs index page markup. Links keep page order (newest first).
// ---------------------------------------------------------------------------

export interface FoiaLogLink {
  url: string;
  /** Month label from the link text, e.g. "July 2026". */
  month: string;
  fromB7AFile: boolean;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isB7ALink(text: string, url: string): boolean {
  return /b7a|7\s*\(?\s*a\s*\)?[^0-9]*exempt|exempt[^0-9]*7\s*\(?\s*a/i.test(`${text} ${url}`);
}

/** Extract monthly CSV links from the FOIA logs index HTML. Never throws. */
export function extractLogLinks(html: string, baseUrl = SEC_FOIA_BASE_URL): FoiaLogLink[] {
  const links: FoiaLogLink[] = [];
  const seen = new Set<string>();
  const anchor = /<a[^>]+href="([^"]*\.csv[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const rawHref = match[1]!.trim();
    if (!rawHref || seen.has(rawHref)) continue;
    let url = rawHref;
    if (/^\//.test(url)) url = `${baseUrl}${url}`;
    else if (!/^https?:\/\//i.test(url)) url = `${baseUrl}/${url}`;
    if (seen.has(url)) continue;
    seen.add(rawHref);
    seen.add(url);
    const text = stripTags(match[2] ?? "");
    const fromB7AFile = isB7ALink(text, url);
    const month = text
      .replace(/,?\s*b7a\s*exemption:?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    links.push({ url, month: month || text || url, fromB7AFile });
  }
  return links;
}

// ---------------------------------------------------------------------------
// Company / ticker matching heuristics.
//
// The pane answers "is company X showing signs of undisclosed SEC
// investigative activity?", so matching is deliberately recall-oriented on
// the Request Description field and strict about tickers:
//
// 1. Description-only. Requester Name/Organization usually name the filer
//    (Probes Reporter and Canary Data file thousands of requests), so
//    matching them would flag every company those firms research. The
//    subject company is named in the description ("records relating to X").
// 2. Tickers (1-5 letters, optional leading $) match on word boundaries,
//    case-insensitive, so "CAT" never matches "certificate" or "locate".
// 3. Company names are lowercased, stripped of punctuation and trailing
//    corporate suffixes (Inc, Corp, LLC, ...); every remaining token of
//    length >= 3 must appear as a whole word in the description. A
//    contiguous full-name hit is reported as the stronger "exact" reason.
// 4. Matching never asserts an investigation exists — the returned reason
//    only explains which mention fired; `classifySignal` grades it.
// ---------------------------------------------------------------------------

const CORPORATE_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "llc",
  "ltd",
  "limited",
  "plc",
  "holdings",
  "holding",
  "group",
  "enterprises",
  "enterprise",
  "partners",
  "partnership",
  "lp",
  "llp",
  "trust",
  "bancorp",
  "financial",
]);

const NAME_STOPWORDS = new Set(["the", "and", "of", "for", "a", "an", "at", "de", "la"]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function stripSuffixes(tokens: string[]): string[] {
  const out = [...tokens];
  while (out.length > 1 && CORPORATE_SUFFIXES.has(out[out.length - 1]!)) out.pop();
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTickerQuery(query: string): boolean {
  return /^\$?[a-z]{1,5}$/i.test(query.trim());
}

export interface CompanyMatch {
  matched: boolean;
  reason: string;
}

/**
 * Test one log entry against a company-name or ticker query.
 * Pure (no network) — covered by unit tests on inline fixtures.
 */
export function matchCompany(entry: FoiaLogEntry, rawQuery: string): CompanyMatch {
  const query = rawQuery.trim();
  if (!query) return { matched: false, reason: "" };
  const description = entry.description;
  if (!description) return { matched: false, reason: "" };

  if (isTickerQuery(query)) {
    const ticker = query.replace(/^\$/, "").toUpperCase();
    const hit = new RegExp(`(^|[^A-Z0-9$])\\$?${escapeRegExp(ticker)}(?![A-Z0-9])`, "i").test(
      description,
    );
    return hit
      ? { matched: true, reason: `ticker "${ticker}" in request description` }
      : { matched: false, reason: "" };
  }

  const queryTokens = stripSuffixes(tokenize(query)).filter(
    (token) => token.length >= 3 && !NAME_STOPWORDS.has(token),
  );
  if (queryTokens.length === 0) return { matched: false, reason: "" };
  const words = new Set(tokenize(description));
  if (!queryTokens.every((token) => words.has(token))) {
    return { matched: false, reason: "" };
  }
  const phrase = queryTokens.join(" ");
  const normalizedDescription = tokenize(description).join(" ");
  if (normalizedDescription.includes(phrase)) {
    return { matched: true, reason: `exact name "${phrase}" in request description` };
  }
  return { matched: true, reason: `tokens ${queryTokens.join("+")} in request description` };
}

// ---------------------------------------------------------------------------
// Signal classification. A 7(A) withholding means the SEC told the requester
// the records exist but relate to an ongoing enforcement proceeding — the
// strongest public hint of undisclosed investigative activity. Everything
// else is graded down; "no records" dispositions are surfaced as-is since
// they cut against the thesis.
// ---------------------------------------------------------------------------

const EXEMPTION_7A = [
  /\bexemption\s*7\s*\(?\s*a\s*\)?/i,
  /\(b\)\s*\(7\)\s*\(a\)/i,
  /7\s*\(a\)/i,
  /\bb7a\b/i,
  /interfere\s+with\s+enforcement/i,
  /pending\s+(law\s+)?enforcement\s+proceeding/i,
];

const ENFORCEMENT_SEEKING = [
  /wells\s+(notice|submission)/i,
  /subpoena/i,
  /\benforcement\s+(action|investigation|proceeding)/i,
  /formal\s+investigation/i,
  /informal\s+investigation/i,
  /investigative?\s+records?/i,
  /matter\s+under\s+inquiry/i,
  /\bmui\b/i,
  /sec\s+probe/i,
  /probe\s+by\s+the\s+sec/i,
];

/** Grade one entry. Pure (no network) — covered by unit tests. */
export function classifySignal(entry: Pick<FoiaLogEntry, "fromB7AFile" | "disposition" | "description" | "status">): FoiaSignal {
  if (entry.fromB7AFile) return "high";
  const haystack = `${entry.disposition}\n${entry.status}\n${entry.description}`;
  if (EXEMPTION_7A.some((pattern) => pattern.test(haystack))) return "high";
  if (ENFORCEMENT_SEEKING.some((pattern) => pattern.test(entry.description))) return "medium";
  return "watch";
}

const SIGNAL_RANK: Record<FoiaSignal, number> = { high: 0, medium: 1, watch: 2 };

function entrySortTime(entry: FoiaLogEntry): number {
  for (const date of [entry.closedDate, entry.dateReceived, entry.dateOfRequest]) {
    const time = date.getTime();
    if (time > 0) return time;
  }
  return 0;
}

/** High signal first, then newest. Pure — covered by unit tests. */
export function sortEntries(entries: FoiaLogEntry[]): FoiaLogEntry[] {
  return [...entries].sort((a, b) => {
    const rank = SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal];
    if (rank !== 0) return rank;
    return entrySortTime(b) - entrySortTime(a);
  });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class FoiaLogsClient {
  private readonly b7aCache = new Map<string, FoiaLogEntry>();

  private async fetchText(url: string, accept: string, signal?: AbortSignal): Promise<string> {
    const response = await foiaFetch.fetch(
      url,
      {
        ...(signal ? { signal } : {}),
        headers: { Accept: accept },
      },
    );
    if (!response.ok) {
      throw new Error(`SEC FOIA request failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  private async discoverLinks(signal?: AbortSignal): Promise<FoiaLogLink[]> {
    return withConnectionRequest(FOIA_LOGS_CONNECTION_ID, "index", async () => {
      const html = await this.fetchText(SEC_FOIA_LOGS_PAGE_URL, "text/html", signal);
      return extractLogLinks(html);
    });
  }

  private async fetchLogFile(
    link: FoiaLogLink,
    signal?: AbortSignal,
  ): Promise<FoiaLogEntry[]> {
    return withConnectionRequest(FOIA_LOGS_CONNECTION_ID, "fetch", async () => {
      const csv = await this.fetchText(link.url, "text/csv", signal);
      return parseFoiaLogCsv(csv, {
        sourceMonth: link.month,
        fromB7AFile: link.fromB7AFile,
        url: link.url,
      });
    });
  }

  /**
   * Search recent monthly logs for a company/ticker. Empty queries return
   * immediately (no network) so the pane can sit on its "Press /" state.
   */
  async searchLogs(
    rawQuery: string,
    options: {
      months?: number;
      b7aMonths?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<FoiaLogPage> {
    const query = rawQuery.trim();
    if (!query) return { entries: [], total: 0 };
    const links = await this.discoverLinks(options.signal);
    const monthly = links.filter((link) => !link.fromB7AFile).slice(0, options.months ?? FOIA_LOGS_DEFAULT_MONTHS);
    const b7a = links.filter((link) => link.fromB7AFile).slice(0, options.b7aMonths ?? FOIA_LOGS_DEFAULT_B7A_MONTHS);
    const files = await Promise.all(
      [...monthly, ...b7a].map((link) => this.fetchLogFile(link, options.signal)),
    );
    const matched: FoiaLogEntry[] = [];
    for (const entries of files) {
      for (const entry of entries) {
        const hit = matchCompany(entry, query);
        if (!hit.matched) continue;
        matched.push({ ...entry, matchReason: hit.reason });
      }
    }
    const sorted = sortEntries(matched).slice(0, FOIA_LOGS_DISPLAY_CAP);
    for (const entry of sorted) this.b7aCache.set(entry.id, entry);
    return { entries: sorted, total: matched.length };
  }

  /**
   * Fetch only the tiny monthly B7A-exemption CSVs (a few KB each) and match
   * them. Backs the command-bar document provider, which must stay cheap.
   */
  async searchRecentB7A(
    rawQuery: string,
    options: { months?: number; limit?: number; signal?: AbortSignal } = {},
  ): Promise<FoiaLogPage> {
    const query = rawQuery.trim();
    if (!query) return { entries: [], total: 0 };
    const links = await this.discoverLinks(options.signal);
    const b7a = links.filter((link) => link.fromB7AFile).slice(0, options.months ?? 2);
    const files = await Promise.all(
      b7a.map((link) => this.fetchLogFile(link, options.signal)),
    );
    const matched: FoiaLogEntry[] = [];
    for (const entries of files) {
      for (const entry of entries) {
        const hit = matchCompany(entry, query);
        if (!hit.matched) continue;
        matched.push({ ...entry, matchReason: hit.reason });
      }
    }
    const limit = Math.max(1, Math.min(options.limit ?? FOIA_B7A_RESULT_LIMIT, 100));
    const sorted = sortEntries(matched);
    for (const entry of sorted) this.b7aCache.set(entry.id, entry);
    return { entries: sorted.slice(0, limit), total: matched.length };
  }

  /** Resolve one cached entry for the document provider's `load`. */
  async loadB7AEntry(id: string, signal?: AbortSignal): Promise<FoiaLogEntry> {
    const cached = this.b7aCache.get(id);
    if (cached) return cached;
    // `id` is `<month>::<request-id>`; re-fetch recent B7A files (tiny CSVs).
    const links = await this.discoverLinks(signal);
    const b7a = links.filter((link) => link.fromB7AFile).slice(0, 2);
    const files = await Promise.all(
      b7a.map((link) => this.fetchLogFile(link, signal)),
    );
    for (const entries of files) {
      for (const entry of entries) {
        this.b7aCache.set(entry.id, entry);
        if (entry.id === id) return entry;
      }
    }
    throw new Error("SEC FOIA log entry was not found in recent B7A files.");
  }
}

// ---------------------------------------------------------------------------
// Command-bar document provider. B7A-flagged requests read naturally as
// documents (one request = one investigative-activity flag), so the log
// entries fit: `search` returns cheap B7A-only hits, `load` renders the
// full flag for the shared article/document reader.
// ---------------------------------------------------------------------------

function formatLogDate(date: Date): string {
  return date.getTime() === 0 ? "—" : date.toISOString().slice(0, 10);
}

function entryToHit(entry: FoiaLogEntry): DocumentSearchHit {
  const title = entry.description
    ? entry.description.replace(/\s+/g, " ").trim().slice(0, 140)
    : `FOIA request ${entry.requestId}`;
  return {
    id: entry.id,
    title,
    publishedAt:
      entry.closedDate.getTime() === 0 ? undefined : entry.closedDate.toISOString(),
    snippet: `B7A investigative-activity flag · ${entry.sourceMonth}${
      entry.disposition ? ` · ${entry.disposition}` : ""
    }`,
    source: "SEC FOIA Logs",
    documentType: "foia",
    url: entry.url || undefined,
    keywords: [entry.sourceMonth, entry.disposition, entry.signal].filter(Boolean),
    metadata: {
      requestId: entry.requestId,
      sourceMonth: entry.sourceMonth,
      disposition: entry.disposition,
      signal: entry.signal,
    },
  };
}

function entryToDocument(entry: FoiaLogEntry): SearchDocument {
  const lines = [
    `**Request ID:** ${entry.requestId}`,
    `**Signal:** ${entry.signal.toUpperCase()} — ${
      entry.signal === "high"
        ? "withheld under Exemption 7(A); possible undisclosed SEC investigation"
        : entry.signal === "medium"
          ? "seeks enforcement/investigative records; no explicit 7(A) cite"
          : "company named in a routine request"
    }`,
    `**Source file:** ${entry.sourceMonth}${entry.fromB7AFile ? " (B7A exemption file)" : ""}`,
    `**Match:** ${entry.matchReason || "—"}`,
    `**Requester:** ${entry.requesterName || "—"}${entry.requesterOrganization ? ` (${entry.requesterOrganization})` : ""}`,
    `**Received:** ${formatLogDate(entry.dateReceived)}`,
    `**Closed:** ${formatLogDate(entry.closedDate)}`,
    `**Disposition:** ${entry.disposition || "—"}`,
    "",
    "Request description:",
    entry.description || "No description published.",
    ...(entry.url ? ["", `Source: ${entry.url}`] : []),
  ];
  return {
    id: entry.id,
    title: entry.description
      ? entry.description.replace(/\s+/g, " ").trim().slice(0, 140)
      : `FOIA request ${entry.requestId}`,
    markdown: lines.join("\n"),
    ...(entry.url ? { sourceUrl: entry.url } : {}),
    metadata: {
      source: "SEC FOIA Logs",
      requestId: entry.requestId,
      sourceMonth: entry.sourceMonth,
      signal: entry.signal,
    },
  };
}

export function createFoiaLogDocumentSearchProvider(
  client = new FoiaLogsClient(),
): DocumentSearchProvider {
  return {
    id: "foia-logs:b7a",
    name: "SEC FOIA B7A flags",
    sourceId: FOIA_LOGS_CONNECTION_ID,
    documentTypes: ["foia"],
    minQueryLength: 2,
    async search(rawQuery, signal) {
      const query = rawQuery.trim();
      if (!query || signal.aborted) return [];
      const limit = FOIA_B7A_RESULT_LIMIT;
      const page = await client.searchRecentB7A(query, { limit, signal });
      if (signal.aborted) return [];
      return page.entries.slice(0, limit).map(entryToHit);
    },
    async load(id, signal): Promise<SearchDocument> {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const entry = await client.loadB7AEntry(id, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return entryToDocument(entry);
    },
  };
}
