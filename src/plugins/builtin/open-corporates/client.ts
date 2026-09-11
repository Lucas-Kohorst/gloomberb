import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  OPEN_CORPORATES_API_BASE_URL,
  OPEN_CORPORATES_CONNECTION_ID,
  type OpenCorporatesCompany,
  type OpenCorporatesCompanyDetail,
  type OpenCorporatesOfficer,
  type OpenCorporatesPage,
} from "./types";

export const COMPANIES_DISPLAY_CAP = 50;

// Free, keyless tier is heavily rate-limited (a few requests per minute per
// IP in practice), so keep our own rate well below that and retry sparingly.
const openCorporatesFetch = createThrottledFetch({
  requestsPerMinute: 10,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 1_000,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-open-corporates",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value: unknown): Date {
  const date = new Date(typeof value === "string" || typeof value === "number" ? value : 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

/** Unwrap the `{ company: {...} }` envelope the API uses in lists and detail. */
function unwrapCompany(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const inner = record.company;
  if (inner && typeof inner === "object") return inner as Record<string, unknown>;
  return record;
}

function unwrapOfficer(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const inner = record.officer;
  if (inner && typeof inner === "object") return inner as Record<string, unknown>;
  return record;
}

export function parseOfficer(raw: unknown): OpenCorporatesOfficer | null {
  const record = unwrapOfficer(raw);
  const name = asString(record.name);
  if (!name) return null;
  return {
    name,
    position: asString(record.position) || asString(record.officer_type) || asString(record.title),
    startDate: asString(record.start_date),
    endDate: asString(record.end_date),
  };
}

export function parseOfficers(value: unknown): OpenCorporatesOfficer[] {
  if (!Array.isArray(value)) return [];
  const officers: OpenCorporatesOfficer[] = [];
  for (const raw of value) {
    const officer = parseOfficer(raw);
    if (officer) officers.push(officer);
  }
  return officers;
}

export function parseCompany(raw: unknown): OpenCorporatesCompany | null {
  const record = unwrapCompany(raw);
  const name = asString(record.name);
  if (!name) return null;
  const companyNumber = asString(record.company_number);
  const jurisdictionCode = asString(record.jurisdiction_code);
  if (!companyNumber || !jurisdictionCode) return null;
  return {
    id: `${jurisdictionCode}/${companyNumber}`,
    name,
    companyNumber,
    jurisdictionCode,
    companyType: asString(record.company_type),
    incorporationDate: asDate(record.incorporation_date),
    currentStatus: asString(record.current_status),
    inactive: asBoolean(record.inactive),
    registeredAddress: asString(record.registered_address_in_full)
      || asString(record.registered_address),
    opencorporatesUrl: asString(record.opencorporates_url),
  };
}

function asTotal(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Parse a `companies/search` payload. Accepts the live envelope
 * (`{ results: { companies: [...], total_count } }`) and tolerates the
 * bare `{ companies: [...] }` shape.
 */
export function parseCompaniesPayload(payload: unknown, cap = COMPANIES_DISPLAY_CAP): OpenCorporatesPage {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const results = (root.results && typeof root.results === "object"
    ? root.results
    : root) as Record<string, unknown>;
  const rawList = Array.isArray(results.companies) ? results.companies : [];
  const companies: OpenCorporatesCompany[] = [];
  for (const raw of rawList) {
    const company = parseCompany(raw);
    if (!company) continue;
    companies.push(company);
    if (companies.length >= cap) break;
  }
  const total = asTotal(results.total_count, companies.length);
  return { companies, total };
}

/**
 * Parse a company detail payload (`companies/{jurisdiction}/{number}`).
 * Officers ride along on the company record; this extracts both.
 */
export function parseCompanyDetailPayload(payload: unknown): OpenCorporatesCompanyDetail | null {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const results = (root.results && typeof root.results === "object"
    ? root.results
    : root) as Record<string, unknown>;
  const company = parseCompany(results.company ?? results);
  if (!company) return null;
  const companyRecord = unwrapCompany(results.company ?? results);
  return { ...company, officers: parseOfficers(companyRecord.officers) };
}

export function buildSearchUrl(query: string): string {
  return `${OPEN_CORPORATES_API_BASE_URL}/companies/search?q=${encodeURIComponent(query.trim())}`;
}

export function buildCompanyUrl(jurisdictionCode: string, companyNumber: string): string {
  return `${OPEN_CORPORATES_API_BASE_URL}/companies/${encodeURIComponent(jurisdictionCode)}/${encodeURIComponent(companyNumber)}`;
}

export class OpenCorporatesClient {
  async searchCompanies(query: string, signal?: AbortSignal): Promise<OpenCorporatesPage> {
    return withConnectionRequest(OPEN_CORPORATES_CONNECTION_ID, "search", async () => {
      const trimmed = query.trim();
      if (!trimmed) return { companies: [], total: 0 };
      const response = await openCorporatesFetch.fetch(buildSearchUrl(trimmed), { signal });
      if (!response.ok) {
        throw new Error(
          `OpenCorporates request failed: ${response.status} ${response.statusText}`,
        );
      }
      return parseCompaniesPayload(await response.json());
    });
  }

  /**
   * Fetch full company detail, including officers. The v0.4 API embeds
   * officers on the company record rather than exposing a separate
   * per-company officers endpoint, so detail + officers share one call.
   */
  async getCompany(
    jurisdictionCode: string,
    companyNumber: string,
    signal?: AbortSignal,
  ): Promise<OpenCorporatesCompanyDetail | null> {
    return withConnectionRequest(OPEN_CORPORATES_CONNECTION_ID, "detail", async () => {
      const response = await openCorporatesFetch.fetch(
        buildCompanyUrl(jurisdictionCode, companyNumber),
        { signal },
      );
      if (!response.ok) {
        throw new Error(
          `OpenCorporates request failed: ${response.status} ${response.statusText}`,
        );
      }
      return parseCompanyDetailPayload(await response.json());
    });
  }
}
