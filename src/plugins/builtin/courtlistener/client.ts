import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import type {
  DocumentSearchHit,
  DocumentSearchProvider,
  SearchDocument,
} from "../../../types/plugin";
import { withConnectionRequest } from "../connections/register";
import {
  COURTLISTENER_API_BASE_URL,
  COURTLISTENER_CONNECTION_ID,
  COURTLISTENER_SITE_BASE_URL,
  type Lawsuit,
  type LawsuitPage,
  type OpinionDetail,
} from "./types";

export const LAWSUIT_PAGE_SIZE = 50;
export const DOCUMENT_SEARCH_RESULT_LIMIT = 40;
export const LATEST_DOCKET_QUERY = "dateFiled:[now-7d TO now]";
const JUNK_CASE_NAME = /^(miscellaneous entry|unknown case title)\b/i;

const courtListenerFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-courtlistener",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

let resolveApiToken: () => string | undefined = () => process.env.COURTLISTENER_API_KEY?.trim() || undefined;

export function setCourtListenerApiTokenResolver(resolver: () => string | undefined): void {
  resolveApiToken = resolver;
}

export function setCourtListenerApiToken(token: string | undefined): void {
  const value = token?.trim() || undefined;
  setCourtListenerApiTokenResolver(() => value);
}

export function resolveCourtListenerApiToken(): string | undefined {
  return resolveApiToken() || process.env.COURTLISTENER_API_KEY?.trim() || undefined;
}

function requestHeaders(): Record<string, string> {
  const token = resolveCourtListenerApiToken();
  return token
    ? {
      Accept: "application/json",
      Authorization: `Token ${token}`,
      "User-Agent": "gloomberb-courtlistener",
    }
    : {
      Accept: "application/json",
      "User-Agent": "gloomberb-courtlistener",
    };
}

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asTrimmed(value);
}

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return 0;
}

function asDate(value: unknown): Date {
  const date = new Date(
    typeof value === "string" || typeof value === "number" ? value : Number.NaN,
  );
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return collapseWhitespace(value.replace(/<[^>]*>/g, " "));
}

function absoluteUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${COURTLISTENER_SITE_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Parse a single v4 search hit into a Lawsuit. Returns null for malformed
 * entries (missing case name and every usable id) so one bad hit never
 * drops the whole page.
 */
function firstRecord(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    return value.find((entry) => entry && typeof entry === "object") as Record<string, unknown> | undefined;
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function recapSnippet(record: Record<string, unknown>): { snippet: string; downloadUrl: string; url: string } {
  const document = firstRecord(record.recap_documents) ?? firstRecord(record.recapDocuments);
  if (!document) return { snippet: "", downloadUrl: "", url: "" };
  const snippet = collapseWhitespace(
    asTrimmed(document.snippet) || asTrimmed(document.description) || asTrimmed(document.short_description),
  ).slice(0, 2000);
  const path = asTrimmed(document.filepath_local);
  return {
    snippet,
    downloadUrl: asTrimmed(document.download_url) || (path ? `${COURTLISTENER_SITE_BASE_URL}/${path}` : ""),
    url: absoluteUrl(asTrimmed(document.absolute_url)),
  };
}

function isUsableLawsuitDate(date: Date): boolean {
  if (date.getTime() === 0) return true;
  return date.getTime() <= Date.now() + 24 * 60 * 60_000;
}

export function parseLawsuit(raw: unknown): Lawsuit | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const caseName = asTrimmed(record.caseName)
    || asTrimmed(record.caseNameFull)
    || asTrimmed(record.case_name_full);
  if (!caseName || JUNK_CASE_NAME.test(caseName)) return null;

  const opinions = Array.isArray(record.opinions) ? record.opinions : [];
  const opinionFields = firstRecord(opinions) ?? {};
  const recap = recapSnippet(record);
  const dateFiled = asDate(record.dateFiled);
  if (!isUsableLawsuitDate(dateFiled)) return null;

  const clusterId = asId(record.cluster_id);
  const docketId = asId(record.docket_id);
  const opinionId = asId(opinionFields.id);
  const kind: Lawsuit["kind"] = docketId && !clusterId ? "docket" : "opinion";
  const url = absoluteUrl(
    asTrimmed(record.absolute_url) || asTrimmed(record.docket_absolute_url) || recap.url,
  );
  const id = docketId
    ? `docket-${docketId}`
    : clusterId
      ? `cluster-${clusterId}`
      : opinionId
        ? `opinion-${opinionId}`
        : url || caseName;
  if (!id) return null;

  const court = asTrimmed(record.court);
  return {
    id,
    kind,
    clusterId,
    opinionId,
    docketId,
    caseName,
    court,
    courtCitation:
      asTrimmed(record.court_citation_string) || asTrimmed(record.court_id) || court,
    dateFiled,
    docketNumber: asTrimmed(record.docketNumber),
    judge: asTrimmed(record.assignedTo) || asTrimmed(record.judge),
    status: asTrimmed(record.suitNature) || asTrimmed(record.status),
    snippet: recap.snippet || collapseWhitespace(asTrimmed(opinionFields.snippet)).slice(0, 2000),
    citeCount: asCount(record.citeCount),
    url,
    downloadUrl: recap.downloadUrl || asTrimmed(opinionFields.download_url),
  };
}

function asNextUrl(value: unknown): string | null {
  const next = asTrimmed(value);
  return next.startsWith("https://") ? next : null;
}

/** Parse a v4 search response payload; never throws on malformed input. */
export function parseSearchPage(payload: unknown, cap = LAWSUIT_PAGE_SIZE): LawsuitPage {
  const record = (
    payload && typeof payload === "object" ? payload : {}
  ) as Record<string, unknown>;
  const results = Array.isArray(record.results) ? record.results : [];
  const lawsuits: Lawsuit[] = [];
  const seen = new Set<string>();
  for (const raw of results) {
    const lawsuit = parseLawsuit(raw);
    if (!lawsuit || seen.has(lawsuit.id)) continue;
    seen.add(lawsuit.id);
    lawsuits.push(lawsuit);
    if (lawsuits.length >= cap) break;
  }
  return {
    lawsuits,
    total: asCount(record.count) || lawsuits.length,
    next: asNextUrl(record.next),
  };
}

export function buildSearchUrl(
  query: string,
  options: { limit?: number; type?: "o" | "r" } = {},
): string {
  const params = new URLSearchParams();
  params.set("q", query.trim() || LATEST_DOCKET_QUERY);
  params.set("type", options.type ?? "r");
  params.set("order_by", "dateFiled desc");
  params.set("page_size", String(Math.max(1, Math.min(options.limit ?? LAWSUIT_PAGE_SIZE, 100))));
  return `${COURTLISTENER_API_BASE_URL}/search/?${params.toString()}`;
}

/**
 * Parse an opinion detail payload. Accepts both a single opinion object and
 * a paged `{ results: [...] }` response (used for the `?cluster=` lookup).
 * Prefers plain text, falls back to stripped HTML, then the snippet.
 */
export function parseOpinionDetail(raw: unknown): OpinionDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const target = (
    Array.isArray(record.results)
      ? record.results.find((entry) => entry && typeof entry === "object")
      : record
  ) as Record<string, unknown> | undefined;
  if (!target) return null;

  const id = asId(target.id);
  if (!id) return null;

  const plainText = asTrimmed(target.plain_text);
  const html = asTrimmed(
    typeof target.html === "string" ? target.html : target.html_lawbox,
  );
  const text =
    plainText || (html ? stripHtml(html) : "") || collapseWhitespace(asTrimmed(target.snippet));
  if (!text) return null;

  return {
    id,
    title: asTrimmed(target.caseName) || `Opinion ${id}`,
    text,
    url: absoluteUrl(asTrimmed(target.absolute_url)),
    court: asTrimmed(target.court),
    dateFiled: asDate(target.dateFiled),
  };
}

async function fetchSearchPage(url: string, signal?: AbortSignal): Promise<LawsuitPage> {
  const response = await courtListenerFetch.fetch(url, {
    headers: requestHeaders(),
    ...(signal ? { signal } : {}),
  });
  if (response.status === 429) {
    throw new Error("CourtListener rate limit exceeded. Add an API token in KEYS or wait and retry.");
  }
  if (!response.ok) {
    throw new Error(`CourtListener request failed: ${response.status} ${response.statusText}`);
  }
  return parseSearchPage(await response.json());
}

export class CourtListenerClient {
  /** RECAP docket search, newest first. Blank query is the last seven days of federal dockets. */
  async searchLawsuits(
    query: string,
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<LawsuitPage> {
    return withConnectionRequest(COURTLISTENER_CONNECTION_ID, "search", () =>
      fetchSearchPage(buildSearchUrl(query, { limit: options.limit }), options.signal),
    );
  }

  async searchLawsuitsPage(nextUrl: string, options: { signal?: AbortSignal } = {}): Promise<LawsuitPage> {
    if (!nextUrl.startsWith(`${COURTLISTENER_API_BASE_URL}/search/`)) {
      throw new Error("Invalid CourtListener pagination URL.");
    }
    return withConnectionRequest(COURTLISTENER_CONNECTION_ID, "search", () =>
      fetchSearchPage(nextUrl, options.signal),
    );
  }

  /**
   * Fetch full opinion text via the opinions endpoint. Accepts a bare opinion
   * id, an `opinion-<id>` hit id, or a `cluster-<id>` hit id (resolved with
   * `opinions/?cluster=<id>` so only the search + opinions endpoints are used).
   */
  async getOpinionDetail(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<OpinionDetail> {
    const trimmed = id.trim();
    const docketMatch = trimmed.match(/^docket-(\d+)$/);
    if (docketMatch) {
      const page = await this.searchLawsuits(`docket_id:${docketMatch[1]}`, { limit: 1, signal: options.signal });
      const lawsuit = page.lawsuits[0];
      if (!lawsuit) throw new Error("CourtListener docket was not found.");
      return {
        id: lawsuit.docketId || lawsuit.id,
        title: lawsuit.caseName,
        text: lawsuit.snippet || `Docket ${lawsuit.docketNumber || lawsuit.id}`,
        url: lawsuit.url,
        court: lawsuit.court,
        dateFiled: lawsuit.dateFiled,
      };
    }
    const clusterMatch = trimmed.match(/^cluster-(\d+)$/);
    const opinionMatch = trimmed.match(/^(?:opinion-)?(\d+)$/);
    const url = clusterMatch
      ? `${COURTLISTENER_API_BASE_URL}/opinions/?cluster=${encodeURIComponent(clusterMatch[1]!)}&page_size=1`
      : opinionMatch
        ? `${COURTLISTENER_API_BASE_URL}/opinions/${encodeURIComponent(opinionMatch[1]!)}/`
        : null;
    if (!url) throw new Error("Invalid CourtListener opinion ID.");
    return withConnectionRequest(COURTLISTENER_CONNECTION_ID, "opinion", async () => {
      const response = await courtListenerFetch.fetch(url, {
        headers: requestHeaders(),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (!response.ok) {
        throw new Error(
          `CourtListener request failed: ${response.status} ${response.statusText}`,
        );
      }
      const detail = parseOpinionDetail(await response.json());
      if (!detail) throw new Error("CourtListener opinion was not found.");
      return detail;
    });
  }
}

const ROUTING_TERMS = new Set([
  "art",
  "article",
  "articles",
  "srch",
  "search",
  "document",
  "documents",
  "law",
  "lawsuit",
  "lawsuits",
  "litigation",
  "court",
  "courts",
  "courtlistener",
  "docket",
  "dockets",
  "opinion",
  "opinions",
  "filing",
  "filings",
]);

export function normalizeCourtListenerDocumentQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter((term) => !ROUTING_TERMS.has(term.toLowerCase().replace(/[^a-z0-9]+/g, "")))
    .join(" ")
    .trim();
}

export function resolveCourtListenerDocumentSearchQuery(query: string): string {
  return normalizeCourtListenerDocumentQuery(query) || query.trim();
}

function lawsuitToHit(lawsuit: Lawsuit): DocumentSearchHit {
  return {
    id: lawsuit.id,
    title: lawsuit.caseName,
    publishedAt:
      lawsuit.dateFiled.getTime() === 0 ? undefined : lawsuit.dateFiled.toISOString(),
    snippet: lawsuit.snippet || undefined,
    source: "CourtListener",
    documentType: "filing",
    url: lawsuit.url || undefined,
    keywords: [lawsuit.courtCitation, lawsuit.court, lawsuit.status, lawsuit.docketNumber].filter(Boolean),
    metadata: {
      court: lawsuit.court,
      docketNumber: lawsuit.docketNumber,
      status: lawsuit.status,
      kind: lawsuit.kind,
    },
  };
}

export function createCourtListenerDocumentSearchProvider(
  client = new CourtListenerClient(),
): DocumentSearchProvider {
  return {
    id: "courtlistener:dockets",
    name: "CourtListener",
    sourceId: COURTLISTENER_CONNECTION_ID,
    documentTypes: ["filing"],
    minQueryLength: 2,
    async search(rawQuery, signal) {
      const query = resolveCourtListenerDocumentSearchQuery(rawQuery);
      if (!query || signal.aborted) return [];
      const page = await client.searchLawsuits(query, { limit: DOCUMENT_SEARCH_RESULT_LIMIT, signal });
      if (signal.aborted) return [];
      return page.lawsuits.slice(0, DOCUMENT_SEARCH_RESULT_LIMIT).map(lawsuitToHit);
    },
    async load(id, signal): Promise<SearchDocument> {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const detail = await client.getOpinionDetail(id, { signal });
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return {
        id,
        title: detail.title,
        markdown: detail.text,
        sourceUrl: detail.url || undefined,
        metadata: {
          source: "CourtListener",
          ...(detail.court ? { court: detail.court } : {}),
          ...(detail.dateFiled.getTime() === 0
            ? {}
            : { date: detail.dateFiled.toISOString() }),
        },
      };
    },
  };
}
