import type {
  DocumentSearchHit,
  DocumentSearchProvider,
  SearchDocument,
} from "../../../types/plugin";
import { getSharedAdjacentClient } from "./client";
import {
  feedLabel,
  filingKindLabel,
  stripLeadingHeading,
} from "./filings-format";
import type { CftcFiling, CftcFilingDetail } from "./types";
import { ADJACENT_CLOUD_CONNECTION_ID } from "../connections/adjacent-cloud";

const RESULT_LIMIT = 4;

const ROUTING_TERMS = new Set([
  "art",
  "article",
  "articles",
  "srch",
  "search",
  "document",
  "documents",
  "cftc",
  "filing",
  "filings",
]);

/** Strip command and corpus words while retaining the organization/product terms Adjacent indexes. */
export function normalizeCftcDocumentQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter((term) => !ROUTING_TERMS.has(term.toLowerCase().replace(/[^a-z0-9]+/g, "")))
    .join(" ")
    .trim();
}

function filingSnippet(filing: CftcFiling): string {
  return [
    filing.description,
    filing.productName,
    filing.productsAffected,
    filing.remarks,
  ].find((value) => !!value?.trim())?.trim() ?? "";
}

function filingTimestampIso(filing: CftcFiling): string | undefined {
  for (const value of [filing.firstSeenAt, filing.lastSeenAt, filing.statusDate] as Array<Date | string | number | undefined>) {
    if (value == null) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime()) && date.getTime() > 0) return date.toISOString();
  }
  return undefined;
}

export function cftcFilingToDocumentHit(filing: CftcFiling): DocumentSearchHit {
  return {
    id: String(filing.id),
    title: filing.title,
    publishedAt: filingTimestampIso(filing),
    snippet: filingSnippet(filing),
    source: "CFTC",
    documentType: filingKindLabel(filing),
    keywords: [filing.orgCode, filing.feed, filing.status, "CFTC", "filing"].filter(Boolean),
    metadata: {
      orgCode: filing.orgCode,
      status: filing.status,
      feed: filing.feed,
      feedLabel: feedLabel(filing),
    },
  };
}

export function cftcDetailToSearchDocument(id: string, detail: CftcFilingDetail): SearchDocument {
  const date = filingTimestampIso(detail.filing);
  return {
    id,
    title: detail.filing.title,
    markdown: stripLeadingHeading(detail.markdown),
    sourceUrl: detail.sourceUrl || undefined,
    documentLinks: detail.documents.map((document) => ({
      label: document.title,
      url: document.url,
    })),
    metadata: {
      source: "CFTC",
      organization: detail.filing.orgCode,
      type: filingKindLabel(detail.filing),
      status: detail.filing.status,
      ...(date ? { date } : {}),
    },
  };
}

export function createCftcDocumentSearchProvider(): DocumentSearchProvider {
  return {
    id: "adjacent:cftc-filings",
    name: "CFTC filings",
    sourceId: ADJACENT_CLOUD_CONNECTION_ID,
    documentTypes: ["filing"],
    minQueryLength: 1,
    async search(rawQuery, signal) {
      const query = normalizeCftcDocumentQuery(rawQuery);
      if (!query || signal.aborted) return [];
      const page = await getSharedAdjacentClient().listFilings({
        search: query,
        page: 1,
        perPage: RESULT_LIMIT,
        sort: "first_seen",
        sortDir: "desc",
      });
      if (signal.aborted) return [];
      return page.filings.slice(0, RESULT_LIMIT).map(cftcFilingToDocumentHit);
    },
    async load(id, signal): Promise<SearchDocument> {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const filingId = Number(id);
      if (!Number.isInteger(filingId)) throw new Error("Invalid CFTC filing ID.");
      const detail = await getSharedAdjacentClient().getFilingDetail(filingId);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!detail) throw new Error("CFTC filing was not found.");
      return cftcDetailToSearchDocument(id, detail);
    },
  };
}
