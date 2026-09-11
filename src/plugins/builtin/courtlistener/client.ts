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

export const LAWSUIT_DISPLAY_CAP = 50;
const DEFAULT_PAGE_SIZE = 50;
const COMMAND_BAR_RESULT_LIMIT = 5;

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
export function parseLawsuit(raw: unknown): Lawsuit | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const caseName = asTrimmed(record.caseName) || asTrimmed(record.caseNameFull);
  if (!caseName) return null;

  const opinions = Array.isArray(record.opinions) ? record.opinions : [];
  const firstOpinion = opinions.find((entry) => entry && typeof entry === "object") as
    | Record<string, unknown>
    | undefined;
  const opinionFields = firstOpinion ?? {};

  const clusterId = asId(record.cluster_id);
  const opinionId = asId(opinionFields.id);
  const url = absoluteUrl(asTrimmed(record.absolute_url));
  const id = clusterId
    ? `cluster-${clusterId}`
    : opinionId
      ? `opinion-${opinionId}`
      : url || caseName;
  if (!id) return null;

  const court = asTrimmed(record.court);
  return {
    id,
    clusterId,
    opinionId,
    caseName,
    court,
    courtCitation:
      asTrimmed(record.court_citation_string) || asTrimmed(record.court_id) || court,
    dateFiled: asDate(record.dateFiled),
    docketNumber: asTrimmed(record.docketNumber),
    judge: asTrimmed(record.judge),
    status: asTrimmed(record.status),
    snippet: collapseWhitespace(asTrimmed(opinionFields.snippet)).slice(0, 2000),
    citeCount: asCount(record.citeCount),
    url,
    downloadUrl: asTrimmed(opinionFields.download_url),
  };
}

/** Parse a v4 search response payload; never throws on malformed input. */
export function parseSearchPage(payload: unknown, cap = LAWSUIT_DISPLAY_CAP): LawsuitPage {
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
  };
}

/**
 * Keyless full-text query against the v4 search endpoint (`type=o` scopes to
 * opinions). No auth params are ever attached.
 */
export function buildSearchUrl(query: string, limit = DEFAULT_PAGE_SIZE): string {
  const params = new URLSearchParams();
  params.set("q", query.trim());
  params.set("type", "o");
  params.set("page_size", String(Math.max(1, Math.min(limit, 100))));
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

export class CourtListenerClient {
  /** Free, keyless opinion search scoped to the query (usually a company name). */
  async searchLawsuits(
    query: string,
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<LawsuitPage> {
    const trimmed = query.trim();
    if (!trimmed) return { lawsuits: [], total: 0 };
    return withConnectionRequest(COURTLISTENER_CONNECTION_ID, "search", async () => {
      const response = await courtListenerFetch.fetch(
        buildSearchUrl(trimmed, options.limit ?? DEFAULT_PAGE_SIZE),
        options.signal ? { signal: options.signal } : undefined,
      );
      if (!response.ok) {
        throw new Error(
          `CourtListener request failed: ${response.status} ${response.statusText}`,
        );
      }
      return parseSearchPage(await response.json());
    });
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
    const clusterMatch = trimmed.match(/^cluster-(\d+)$/);
    const opinionMatch = trimmed.match(/^(?:opinion-)?(\d+)$/);
    const url = clusterMatch
      ? `${COURTLISTENER_API_BASE_URL}/opinions/?cluster=${encodeURIComponent(clusterMatch[1]!)}&page_size=1`
      : opinionMatch
        ? `${COURTLISTENER_API_BASE_URL}/opinions/${encodeURIComponent(opinionMatch[1]!)}/`
        : null;
    if (!url) throw new Error("Invalid CourtListener opinion ID.");
    return withConnectionRequest(COURTLISTENER_CONNECTION_ID, "opinion", async () => {
      const response = await courtListenerFetch.fetch(
        url,
        options.signal ? { signal: options.signal } : undefined,
      );
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

function lawsuitToHit(lawsuit: Lawsuit): DocumentSearchHit {
  return {
    id: lawsuit.opinionId || lawsuit.id,
    title: lawsuit.caseName,
    publishedAt:
      lawsuit.dateFiled.getTime() === 0 ? undefined : lawsuit.dateFiled.toISOString(),
    snippet: lawsuit.snippet || undefined,
    source: "CourtListener",
    documentType: "opinion",
    url: lawsuit.url || undefined,
    keywords: [lawsuit.courtCitation, lawsuit.court, lawsuit.status].filter(Boolean),
    metadata: {
      court: lawsuit.court,
      docketNumber: lawsuit.docketNumber,
      status: lawsuit.status,
    },
  };
}

export function createCourtListenerDocumentSearchProvider(
  client = new CourtListenerClient(),
): DocumentSearchProvider {
  return {
    id: "courtlistener:opinions",
    name: "CourtListener opinions",
    sourceId: COURTLISTENER_CONNECTION_ID,
    documentTypes: ["opinion"],
    minQueryLength: 2,
    async search(rawQuery, signal) {
      const query = rawQuery.trim();
      if (!query || signal.aborted) return [];
      const limit = COMMAND_BAR_RESULT_LIMIT;
      const page = await client.searchLawsuits(query, { limit, signal });
      if (signal.aborted) return [];
      return page.lawsuits.slice(0, limit).map(lawsuitToHit);
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
