import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  FEDERAL_REGISTER_API_BASE_URL,
  FEDERAL_REGISTER_CONNECTION_ID,
  type FedRegisterDetail,
  type FedRegisterDoc,
  type FedRegisterPage,
} from "./types";

const federalRegisterFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-federal-register",
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

function asOptionalDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const date = asDate(value);
  return date.getTime() === 0 ? null : date;
}

function parseDoc(raw: unknown): FedRegisterDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const documentNumber = asString(record.document_number);
  const title = asString(record.title);
  if (!documentNumber || !title) return null;
  const agencies = Array.isArray(record.agencies)
    ? record.agencies
      .map((agency) => {
        if (typeof agency === "string") return agency.trim();
        if (agency && typeof agency === "object") return asString((agency as Record<string, unknown>).name);
        return "";
      })
      .filter(Boolean)
    : [];
  return {
    documentNumber,
    title,
    type: asString(record.type) || "NOTICE",
    publicationDate: asDate(record.publication_date),
    agencies,
    abstract: asString(record.abstract),
    htmlUrl: asString(record.html_url),
    pdfUrl: asString(record.pdf_url),
    regulatoryIdNumber: asString(record.regulatory_id_number),
    significant: record.significant === true,
    commentsCloseDate: asOptionalDate(record.comments_close_date),
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await federalRegisterFetch.fetch(url);
  if (!response.ok) {
    throw new Error(`Federal Register request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export class FederalRegisterClient {
  async searchDocuments(query: string, page = 1): Promise<FedRegisterPage> {
    return withConnectionRequest(FEDERAL_REGISTER_CONNECTION_ID, "fetch", async () => {
      const params = new URLSearchParams({
        search: query.trim(),
        per_page: "50",
        order: "newest",
      });
      if (page > 1) params.set("page", String(page));
      const payload = await fetchJson(`${FEDERAL_REGISTER_API_BASE_URL}/documents.json?${params}`);
      const record = payload && typeof payload === "object"
        ? payload as Record<string, unknown>
        : {};
      const rawResults = Array.isArray(record.results) ? record.results : [];
      const documents: FedRegisterDoc[] = [];
      for (const raw of rawResults) {
        const doc = parseDoc(raw);
        if (!doc) continue;
        documents.push(doc);
        if (documents.length >= 50) break;
      }
      const total = typeof record.count === "number" && Number.isFinite(record.count)
        ? record.count
        : documents.length;
      return {
        documents,
        total,
        hasNext: typeof record.next_page_url === "string" && record.next_page_url.length > 0,
      };
    });
  }

  async getDocumentDetail(documentNumber: string): Promise<FedRegisterDetail | null> {
    return withConnectionRequest(FEDERAL_REGISTER_CONNECTION_ID, "fetch", async () => {
      const payload = await fetchJson(
        `${FEDERAL_REGISTER_API_BASE_URL}/documents/${encodeURIComponent(documentNumber)}.json`,
      );
      const doc = parseDoc(payload);
      if (!doc) return null;
      const record = payload as Record<string, unknown>;
      return {
        doc,
        bodyHtml: asString(record.body_html),
        sourceUrl: doc.htmlUrl,
      };
    });
  }
}
