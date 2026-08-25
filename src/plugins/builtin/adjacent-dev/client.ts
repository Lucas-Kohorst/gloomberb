import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  ADJACENT_DEV_BASE_URL,
  ADJACENT_DEV_CONNECTION_ID,
  type CftcFiling,
  type CftcFilingDocument,
  type CftcFilingsResponse,
  type CftcFilingDocumentsResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

const devFetch = createThrottledFetch({
  requestsPerMinute: 60,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-adjacent-dev",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function buildUrl(path: string, search?: string): string {
  const trimmed = path.replace(/^\//, "");
  const qs = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${ADJACENT_DEV_BASE_URL}/${trimmed}${qs}`;
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function parseFiling(raw: unknown): CftcFiling | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const accessionNumber = String(record.accessionNumber ?? record.accession_number ?? "").trim();
  if (!accessionNumber) return null;
  const form = String(record.form ?? record.form_type ?? "").trim();
  const filingDateRaw = record.filingDate ?? record.filing_date;
  const filingDate = filingDateRaw instanceof Date
    ? filingDateRaw
    : typeof filingDateRaw === "string" || typeof filingDateRaw === "number"
      ? new Date(filingDateRaw)
      : new Date();
  return {
    accessionNumber,
    form,
    filingDate,
    acceptedAt: record.acceptedAt ?? record.accepted_at
      ? new Date((record.acceptedAt ?? record.accepted_at) as string)
      : undefined,
    primaryDocument: record.primaryDocument ?? record.primary_document
      ? String(record.primaryDocument ?? record.primary_document)
      : undefined,
    primaryDocDescription: record.primaryDocDescription ?? record.primary_doc_description
      ? String(record.primaryDocDescription ?? record.primary_doc_description)
      : undefined,
    items: record.items ? String(record.items) : undefined,
    companyName: record.companyName ?? record.company_name
      ? String(record.companyName ?? record.company_name)
      : undefined,
    ticker: record.ticker ? String(record.ticker) : undefined,
    filingUrl: String(record.filingUrl ?? record.filing_url ?? ""),
    primaryDocumentUrl: record.primaryDocumentUrl ?? record.primary_document_url
      ? String(record.primaryDocumentUrl ?? record.primary_document_url)
      : undefined,
  };
}

function parseFilingDocument(raw: unknown): CftcFilingDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const type = String(record.type ?? "").trim();
  const document = String(record.document ?? record.url ?? "").trim();
  if (!type || !document) return null;
  return {
    sequence: record.sequence ? String(record.sequence) : undefined,
    type,
    description: record.description ? String(record.description) : undefined,
    document,
    url: String(record.url ?? document),
  };
}

export interface AdjacentDevClientOptions {
  apiKey?: string;
}

export class AdjacentDevClient {
  readonly apiKey: string | undefined;

  constructor(options: AdjacentDevClientOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
  }

  private get headers(): Record<string, string> {
    return authHeaders(this.apiKey);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await devFetch.fetch(url, { headers: this.headers });
    if (!response.ok) {
      throw new Error(`Adjacent Dev request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  async getRecentFilings(count = 50): Promise<CftcFiling[]> {
    return withConnectionRequest(ADJACENT_DEV_CONNECTION_ID, "fetch", async () => {
      const url = buildUrl("filings", `count=${count}`);
      const data = await this.fetchJson<CftcFilingsResponse>(url);
      return (data.filings ?? [])
        .map(parseFiling)
        .filter((f): f is CftcFiling => f !== null);
    });
  }

  async searchFilings(query: string, count = 50): Promise<CftcFiling[]> {
    return withConnectionRequest(ADJACENT_DEV_CONNECTION_ID, "fetch", async () => {
      const url = buildUrl("filings", `q=${encodeURIComponent(query)}&count=${count}`);
      const data = await this.fetchJson<CftcFilingsResponse>(url);
      return (data.filings ?? [])
        .map(parseFiling)
        .filter((f): f is CftcFiling => f !== null);
    });
  }

  async getFilingDocuments(accessionNumber: string): Promise<CftcFilingDocument[]> {
    return withConnectionRequest(ADJACENT_DEV_CONNECTION_ID, "fetch", async () => {
      const url = buildUrl(`filings/${encodeURIComponent(accessionNumber)}/documents`);
      const data = await this.fetchJson<CftcFilingDocumentsResponse>(url);
      return (data.documents ?? [])
        .map(parseFilingDocument)
        .filter((d): d is CftcFilingDocument => d !== null);
    });
  }

  async getFilingContent(accessionNumber: string): Promise<string | null> {
    return withConnectionRequest(ADJACENT_DEV_CONNECTION_ID, "fetch", async () => {
      const url = buildUrl(`filings/${encodeURIComponent(accessionNumber)}/content`);
      const response = await devFetch.fetch(url, { headers: this.headers });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = await response.json() as { content?: string };
        return data.content ?? null;
      }
      return response.text();
    });
  }
}

// Standalone browser loader (used by the pane, like loadSecBrowserFilings)
export async function loadCftcBrowserFilings(
  client: AdjacentDevClient,
  query: string,
): Promise<CftcFiling[]> {
  const normalized = query.trim();
  return normalized
    ? client.searchFilings(normalized)
    : client.getRecentFilings();
}
