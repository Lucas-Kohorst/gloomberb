import type {
  DocumentSearchHit,
  DocumentSearchProvider,
  GloomPlugin,
  GloomPluginContext,
  SearchDocument,
} from "../../../types/plugin";
import type { SecFilingItem } from "../../../types/data-provider";
import { SecEdgarClient } from "../../../sources/sec-edgar";
import { registerConnectionSource, withConnectionRequest } from "../connections/register";

export const SEC_FTS_PLUGIN_ID = "sec-fts";
export const SEC_FTS_CONNECTION_ID = "sec-fts";
export const SEC_FTS_DOCUMENT_PROVIDER_ID = "sec:full-text";

const COMMAND_BAR_RESULT_LIMIT = 5;

/** Minimal surface of SecEdgarClient used here so tests can inject a stub. */
export interface SecFtsClientLike {
  searchFilings(query: string, count: number): Promise<SecFilingItem[]>;
  getFilingContent(
    filing: Pick<SecFilingItem, "primaryDocumentUrl" | "filingUrl" | "form">,
  ): Promise<string | null>;
}

const ROUTING_TERMS = new Set([
  "art",
  "article",
  "articles",
  "srch",
  "search",
  "document",
  "documents",
  "filing",
  "filings",
  "sec",
  "edgar",
]);

/** Strip command and corpus words while retaining the full-text terms EFTS indexes. */
export function normalizeSecFtsDocumentQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter((term) => !ROUTING_TERMS.has(term.toLowerCase().replace(/[^a-z0-9]+/g, "")))
    .join(" ")
    .trim();
}

function filingDateIso(filing: SecFilingItem): string | undefined {
  const value = filing.filingDate;
  const date = value instanceof Date ? value : new Date(value as unknown as string);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return undefined;
  return date.toISOString();
}

function entityLabel(filing: SecFilingItem): string {
  if (filing.companyName && filing.ticker) return `${filing.companyName} (${filing.ticker})`;
  return filing.companyName ?? filing.ticker ?? "SEC filing";
}

function meaningfulDescription(filing: SecFilingItem): string | undefined {
  const description = filing.primaryDocDescription?.trim();
  if (!description) return undefined;
  if (description.toUpperCase() === filing.form.trim().toUpperCase()) return undefined;
  return description;
}

export function secFilingTitle(filing: SecFilingItem): string {
  const form = filing.form.trim() || "Filing";
  const description = meaningfulDescription(filing);
  return description
    ? `${entityLabel(filing)} ${form} — ${description}`
    : `${entityLabel(filing)} ${form}`;
}

export function secFilingSnippet(filing: SecFilingItem): string {
  const parts: string[] = [];
  const description = meaningfulDescription(filing);
  if (description) parts.push(description);
  if (filing.items?.trim()) parts.push(`Items ${filing.items.trim()}`);
  if (filing.primaryDocument?.trim()) parts.push(filing.primaryDocument.trim());
  const date = filingDateIso(filing)?.slice(0, 10);
  if (date) parts.push(`Filed ${date}`);
  const snippet = parts.join(" · ").slice(0, 500);
  return snippet || filing.form.trim() || "SEC filing";
}

export function secFilingToDocumentHit(filing: SecFilingItem): DocumentSearchHit {
  const keywords = [
    filing.ticker,
    filing.form,
    filing.companyName,
    "SEC",
    "filing",
    "EDGAR",
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .slice(0, 8);
  return {
    id: filing.accessionNumber,
    title: secFilingTitle(filing),
    publishedAt: filingDateIso(filing),
    snippet: secFilingSnippet(filing),
    source: "SEC",
    documentType: "filing",
    url: filing.filingUrl || undefined,
    keywords,
    metadata: {
      form: filing.form.trim(),
      cik: filing.cik,
      accessionNumber: filing.accessionNumber,
      ...(filing.ticker?.trim() ? { ticker: filing.ticker.trim() } : {}),
      ...(filing.companyName?.trim() ? { company: filing.companyName.trim() } : {}),
      ...(filing.items?.trim() ? { items: filing.items.trim() } : {}),
    },
  };
}

export function secFilingToSearchDocument(
  id: string,
  filing: SecFilingItem,
  content: string | null | undefined,
): SearchDocument {
  const body = content?.trim() || secFilingSnippet(filing);
  const sourceUrl = filing.primaryDocumentUrl || filing.filingUrl || undefined;
  const date = filingDateIso(filing);
  return {
    id,
    title: secFilingTitle(filing),
    markdown: body,
    sourceUrl,
    documentLinks:
      filing.filingUrl && filing.filingUrl !== sourceUrl
        ? [{ label: "Filing index", url: filing.filingUrl }]
        : [],
    metadata: {
      source: "SEC",
      type: "filing",
      form: filing.form.trim(),
      cik: filing.cik,
      accessionNumber: filing.accessionNumber,
      ...(filing.ticker?.trim() ? { ticker: filing.ticker.trim() } : {}),
      ...(filing.companyName?.trim() ? { company: filing.companyName.trim() } : {}),
      ...(date ? { date } : {}),
    },
  };
}

export function createSecFtsDocumentSearchProvider(
  client: SecFtsClientLike = new SecEdgarClient(),
): DocumentSearchProvider {
  const filingsByAccession = new Map<string, SecFilingItem>();
  return {
    id: SEC_FTS_DOCUMENT_PROVIDER_ID,
    name: "SEC filings",
    sourceId: SEC_FTS_CONNECTION_ID,
    documentTypes: ["filing"],
    minQueryLength: 2,
    async search(rawQuery, signal) {
      const query = normalizeSecFtsDocumentQuery(rawQuery);
      if (!query || signal.aborted) return [];
      const limit = COMMAND_BAR_RESULT_LIMIT;
      const filings = await withConnectionRequest(SEC_FTS_CONNECTION_ID, "search", () =>
        client.searchFilings(query, limit),
      );
      if (signal.aborted) return [];
      for (const filing of filings) filingsByAccession.set(filing.accessionNumber, filing);
      return filings.slice(0, limit).map(secFilingToDocumentHit);
    },
    async load(id, signal): Promise<SearchDocument> {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const accession = id.trim();
      if (!accession) throw new Error("Invalid SEC filing ID.");
      const filing = filingsByAccession.get(accession);
      if (!filing) throw new Error("SEC filing was not found. Search again to refresh results.");
      const content = await withConnectionRequest(SEC_FTS_CONNECTION_ID, "fetch", () =>
        client.getFilingContent(filing),
      );
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return secFilingToSearchDocument(accession, filing, content);
    },
  };
}

let disposeConnection: (() => void) | null = null;
let disposeDocumentSearch: (() => void) | null = null;

export const secFtsPlugin: GloomPlugin = {
  id: SEC_FTS_PLUGIN_ID,
  name: "SEC Full-Text Search",
  version: "1.0.0",
  description:
    "SEC EDGAR full-text search across 20 years of filings for SRCH/ART document lookup. No API key required.",
  toggleable: true,

  setup(ctx: GloomPluginContext) {
    disposeConnection = registerConnectionSource({
      id: SEC_FTS_CONNECTION_ID,
      name: "SEC Full-Text Search",
      kind: "api",
      pluginId: SEC_FTS_PLUGIN_ID,
      authRequired: false,
    });
    disposeDocumentSearch = ctx.registerDocumentSearchProvider(
      createSecFtsDocumentSearchProvider(),
    );
  },

  dispose() {
    disposeDocumentSearch?.();
    disposeDocumentSearch = null;
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default secFtsPlugin;
