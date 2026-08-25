import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  ADJACENT_DEV_AUTH_PREFIX,
  ADJACENT_DEV_BASE_URL,
  ADJACENT_DEV_CONNECTION_ID,
  ADJACENT_DEV_PUBLIC_PREFIX,
  type CftcFeed,
  type CftcFiling,
  type CftcFilingDetail,
  type CftcFilingDocument,
  type CftcFilingFilters,
  type CftcFilingsPage,
  type CftcFilingsQuery,
  type CftcPageMeta,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PER_PAGE = 100;
const MAX_PER_PAGE = 500;

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

const FEEDS: readonly CftcFeed[] = ["ptc_dcm_rules", "dcm_products", "dco", "dco_rules"];

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asFeed(value: unknown): CftcFeed {
  return FEEDS.includes(value as CftcFeed) ? value as CftcFeed : "dcm_products";
}

function parseFiling(raw: unknown): CftcFiling | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "number" ? record.id : Number(record.id);
  if (!Number.isFinite(id)) return null;
  const title = asString(record.title);
  if (!title) return null;
  return {
    id,
    title,
    feed: asFeed(record.feed),
    orgCode: asString(record.org_code) ?? "",
    status: asString(record.status) ?? "",
    statusDate: asDate(record.status_date) ?? new Date(0),
    docCount: typeof record.doc_count === "number" ? record.doc_count : 0,
    description: asString(record.description),
    productName: asString(record.product_name),
    productType: asString(record.product_type),
    category: asString(record.category),
    subcategory: asString(record.subcategory),
    productsAffected: asString(record.products_affected),
    remarks: asString(record.remarks),
    receiptDate: asDate(record.receipt_date),
    predictedEffectiveDate: asDate(record.predicted_effective_date),
    firstSeenAt: asDate(record.first_seen_at),
    lastSeenAt: asDate(record.last_seen_at),
  };
}

function parseDocument(raw: unknown): CftcFilingDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const url = asString(record.url);
  if (!url) return null;
  return { url, title: asString(record.title) ?? url };
}

function parseMeta(raw: unknown): CftcPageMeta {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    total: num(record.total),
    page: num(record.page) ?? 1,
    perPage: num(record.per_page) ?? DEFAULT_PER_PAGE,
    totalPages: num(record.total_pages),
    hasNext: record.has_next === true,
    hasPrev: record.has_prev === true,
    totalCapped: record.total_capped === true ? true : undefined,
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

  /** True when requests can reach the full catalog rather than the 90-day window. */
  get authenticated(): boolean {
    return this.apiKey !== undefined;
  }

  private get prefix(): string {
    return this.apiKey ? ADJACENT_DEV_AUTH_PREFIX : ADJACENT_DEV_PUBLIC_PREFIX;
  }

  private get headers(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  private buildUrl(path: string, search?: URLSearchParams): string {
    const trimmed = path.replace(/^\//, "");
    const qs = search && [...search.keys()].length > 0 ? `?${search.toString()}` : "";
    return `${ADJACENT_DEV_BASE_URL}/${this.prefix}/${trimmed}${qs}`;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await devFetch.fetch(url, { headers: this.headers });
    if (!response.ok) {
      const detail = response.status === 401 || response.status === 403
        ? " (add an Adjacent Dev API key to reach the full catalog)"
        : "";
      throw new Error(
        `Adjacent Dev request failed: ${response.status} ${response.statusText}${detail}`,
      );
    }
    return response.json() as Promise<T>;
  }

  async listFilings(query: CftcFilingsQuery = {}): Promise<CftcFilingsPage> {
    return withConnectionRequest(ADJACENT_DEV_CONNECTION_ID, "fetch", async () => {
      const search = new URLSearchParams();
      if (query.feed) search.set("feed", query.feed);
      if (query.org) search.set("org", query.org);
      if (query.status) search.set("status", query.status);
      if (query.q?.trim()) search.set("q", query.q.trim());
      if (query.page && query.page > 1) search.set("page", String(query.page));
      search.set(
        "per_page",
        String(Math.min(query.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE)),
      );
      const payload = await this.fetchJson<{ data?: unknown[]; meta?: unknown }>(
        this.buildUrl("filings", search),
      );
      return {
        filings: (payload.data ?? [])
          .map(parseFiling)
          .filter((filing): filing is CftcFiling => filing !== null),
        meta: parseMeta(payload.meta),
      };
    });
  }

  /**
   * Filing plus converted attachment text. The list rows carry no external
   * link, so this is also where `sourceUrl` for the open/pop-out hints
   * comes from.
   */
  async getFilingDetail(id: number): Promise<CftcFilingDetail | null> {
    return withConnectionRequest(ADJACENT_DEV_CONNECTION_ID, "fetch", async () => {
      const response = await devFetch.fetch(
        this.buildUrl(`filings/${encodeURIComponent(String(id))}/markdown`),
        { headers: this.headers },
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(
          `Adjacent Dev request failed: ${response.status} ${response.statusText}`,
        );
      }
      const payload = await response.json() as {
        filing?: unknown;
        markdown?: unknown;
        documents?: unknown[];
        source_url?: unknown;
      };
      const filing = parseFiling(payload.filing);
      if (!filing) return null;
      return {
        filing,
        markdown: asString(payload.markdown) ?? "",
        documents: (payload.documents ?? [])
          .map(parseDocument)
          .filter((doc): doc is CftcFilingDocument => doc !== null),
        sourceUrl: asString(payload.source_url) ?? "",
      };
    });
  }

  async getFilters(): Promise<CftcFilingFilters> {
    return withConnectionRequest(ADJACENT_DEV_CONNECTION_ID, "fetch", async () => {
      const payload = await this.fetchJson<{
        feeds?: unknown[];
        orgs?: unknown[];
        statuses?: unknown[];
      }>(this.buildUrl("filings/filters"));
      const strings = (values: unknown[] | undefined): string[] =>
        (values ?? []).map(asString).filter((value): value is string => value !== undefined);
      return {
        feeds: strings(payload.feeds),
        orgs: strings(payload.orgs),
        statuses: strings(payload.statuses),
      };
    });
  }
}

/**
 * Loads the pane's list. `q` is a lexical filter the public tier also honours,
 * so search works without a key.
 */
export async function loadCftcFilings(
  client: AdjacentDevClient,
  query: string,
  perPage = DEFAULT_PER_PAGE,
): Promise<CftcFilingsPage> {
  const normalized = query.trim();
  return client.listFilings(normalized ? { q: normalized, perPage } : { perPage });
}
