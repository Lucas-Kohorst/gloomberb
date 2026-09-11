import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  CFPB_API_BASE_URL,
  CFPB_COMPLAINTS_CONNECTION_ID,
  type CfpbComplaint,
  type CfpbComplaintPage,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

/** Verified against the live API: size=25 with date sort returns in seconds; size=50 takes ~24s. */
export const CFPB_DISPLAY_CAP = 25;

const cfpbFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-cfpb-complaints",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asTotal(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  const direct = record.value;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  return 0;
}

/**
 * Parse one `_source` hit into a complaint. The complaint_id is the only
 * identity field; every other field falls back to a placeholder so a sparse
 * row still renders instead of dropping out of the volumes list.
 */
export function parseComplaint(raw: unknown): CfpbComplaint | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  const id = asString(source.complaint_id);
  if (!id) return null;

  return {
    id,
    product: asString(source.product) ?? "—",
    subProduct: asString(source.sub_product) ?? "",
    issue: asString(source.issue) ?? "—",
    subIssue: asString(source.sub_issue) ?? "",
    company: asString(source.company) ?? "—",
    state: asString(source.state) ?? "",
    dateReceived: asDate(source.date_received) ?? new Date(0),
    companyResponse: asString(source.company_response) ?? "",
    timely: asString(source.timely) ?? "",
    submittedVia: asString(source.submitted_via) ?? "",
    hasNarrative: source.has_narrative === true || source.has_narrative === 1,
    narrative: asString(source.complaint_what_happened) ?? "",
  };
}

/** Pull complaint rows out of a search response body; junk rows are skipped. */
export function parseComplaintsPayload(data: unknown, cap = CFPB_DISPLAY_CAP): CfpbComplaint[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const hits = (record.hits && typeof record.hits === "object" ? record.hits : {}) as Record<
    string,
    unknown
  >;
  const rows = Array.isArray(hits.hits) ? hits.hits : [];
  const complaints: CfpbComplaint[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const nested = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const complaint = parseComplaint(nested._source);
    if (!complaint || seen.has(complaint.id)) continue;
    seen.add(complaint.id);
    complaints.push(complaint);
    if (complaints.length >= cap) break;
  }
  return complaints;
}

/** Total matching complaints from `hits.total.value`; 0 when absent. */
export function complaintTotal(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const record = data as Record<string, unknown>;
  const hits = (record.hits && typeof record.hits === "object" ? record.hits : {}) as Record<
    string,
    unknown
  >;
  return asTotal(hits.total);
}

export interface ComplaintsQuery {
  searchTerm?: string;
  product?: string;
  company?: string;
  size?: number;
}

export function buildComplaintsUrl(query: ComplaintsQuery): string {
  const params = new URLSearchParams();
  params.set("size", String(query.size ?? CFPB_DISPLAY_CAP));
  // Newest complaints first so the pane reads as a live volumes feed.
  params.set("sort_by", "date_received");
  params.set("sort_order", "desc");
  const searchTerm = query.searchTerm?.trim();
  if (searchTerm) params.set("search_term", searchTerm);
  const product = query.product?.trim();
  if (product) params.set("product", product);
  const company = query.company?.trim();
  if (company) params.set("company", company);
  return `${CFPB_API_BASE_URL}?${params.toString()}`;
}

export class CfpbComplaintsClient {
  /**
   * Fetch complaints from the CFPB search API. No API key is required.
   * `searchTerm` is a server-side full-text query; `product` and `company`
   * are exact-match server-side filters.
   */
  async listComplaints(query: ComplaintsQuery): Promise<CfpbComplaintPage> {
    return withConnectionRequest(CFPB_COMPLAINTS_CONNECTION_ID, "fetch", async () => {
      const url = buildComplaintsUrl(query);
      const response = await cfpbFetch.fetch(url);
      if (!response.ok) {
        throw new Error(
          `CFPB request failed: ${response.status} ${response.statusText}`,
        );
      }
      const data: unknown = await response.json();
      return {
        complaints: parseComplaintsPayload(data, query.size ?? CFPB_DISPLAY_CAP),
        total: complaintTotal(data),
      };
    });
  }
}
