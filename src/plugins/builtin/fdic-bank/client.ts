import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  FDIC_API_BASE_URL,
  FDIC_BANK_CONNECTION_ID,
  type BankFailure,
  type BankRecord,
  type BankRiskPage,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

export const FDIC_DISPLAY_CAP = 50;

const INSTITUTION_FIELDS = [
  "NAME",
  "CERT",
  "CITY",
  "STALP",
  "STNAME",
  "BKCLASS",
  "ACTIVE",
  "ASSET",
  "DEP",
  "WEBADDR",
].join(",");

const FAILURE_FIELDS = [
  "NAME",
  "CERT",
  "CITY",
  "PSTALP",
  "FAILDATE",
  "FAILYR",
  "RESTYPE",
].join(",");

const fdicFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-fdic-bank",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asCert(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function asMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asFailDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapePhrase(value: string): string {
  return value.replace(/"/g, "");
}

/**
 * Free text becomes one Elasticsearch query-string filter for /institutions:
 * digits hit CERT, a bare 2-letter code hits STALP, phrases are quoted,
 * single tokens get a trailing wildcard.
 */
export function buildInstitutionsFilter(query: string): string {
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) return `CERT:${trimmed}`;
  if (/^[A-Za-z]{2}$/.test(trimmed)) return `STALP:${trimmed.toUpperCase()}`;
  if (trimmed.includes(" ")) return `NAME:"${escapePhrase(trimmed)}"`;
  return `NAME:${escapePhrase(trimmed)}*`;
}

/**
 * Free text becomes one Elasticsearch query-string filter for /failures:
 * digits hit CERT, a 4-digit number hits FAILYR, a bare 2-letter code hits
 * PSTALP, otherwise the bank name is matched like institutions.
 */
export function buildFailuresFilter(query: string): string {
  const trimmed = query.trim();
  if (/^\d{4}$/.test(trimmed)) return `FAILYR:${trimmed}`;
  if (/^\d+$/.test(trimmed)) return `CERT:${trimmed}`;
  if (/^[A-Za-z]{2}$/.test(trimmed)) return `PSTALP:${trimmed.toUpperCase()}`;
  if (trimmed.includes(" ")) return `NAME:"${escapePhrase(trimmed)}"`;
  return `NAME:${escapePhrase(trimmed)}*`;
}

export function buildInstitutionsUrl(query: string, limit = FDIC_DISPLAY_CAP): string {
  const params = new URLSearchParams({
    filters: buildInstitutionsFilter(query),
    fields: INSTITUTION_FIELDS,
    limit: String(limit),
    format: "json",
  });
  return `${FDIC_API_BASE_URL}/institutions?${params.toString()}`;
}

export function buildFailuresUrl(query: string, limit = FDIC_DISPLAY_CAP): string {
  const params = new URLSearchParams({
    fields: FAILURE_FIELDS,
    limit: String(limit),
    format: "json",
    sort_by: "FAILDATE",
    sort_order: "DESC",
  });
  if (query.trim()) params.set("filters", buildFailuresFilter(query));
  return `${FDIC_API_BASE_URL}/failures?${params.toString()}`;
}

export function parseBankRecord(raw: unknown): BankRecord | null {
  const envelope = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  // Live shape nests the record under `data` with a sibling `score`.
  const record = (
    envelope && envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : envelope
  ) as Record<string, unknown> | null;
  if (!record) return null;
  const cert = asCert(record.CERT);
  const name = asString(record.NAME);
  if (cert == null || !name) return null;
  return {
    cert,
    name,
    city: asString(record.CITY),
    state: asString(record.STALP),
    stateName: asString(record.STNAME),
    bankClass: asString(record.BKCLASS),
    active: record.ACTIVE === 1 || record.ACTIVE === "1",
    assets: asMoney(record.ASSET),
    deposits: asMoney(record.DEP),
    webAddress: asString(record.WEBADDR),
  };
}

export function parseFailureRecord(raw: unknown): BankFailure | null {
  const envelope = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const record = (
    envelope && envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : envelope
  ) as Record<string, unknown> | null;
  if (!record) return null;
  const name = asString(record.NAME);
  if (!name) return null;
  return {
    id: asString(record.ID) || `${name}|${asString(record.FAILDATE)}`,
    name,
    cert: asCert(record.CERT),
    city: asString(record.CITY),
    state: asString(record.PSTALP),
    failDate: asFailDate(record.FAILDATE),
    failYear: asString(record.FAILYR),
    actionType: asString(record.RESTYPE) || "FAILURE",
  };
}

function parsePayload<T>(
  body: unknown,
  parse: (raw: unknown) => T | null,
  cap = FDIC_DISPLAY_CAP,
): T[] {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const rows = record && Array.isArray(record.data) ? record.data : [];
  const seen = new Set<string>();
  const items: T[] = [];
  for (const raw of rows) {
    const item = parse(raw);
    if (!item) continue;
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= cap) break;
  }
  return items;
}

export function parseInstitutionsPayload(body: unknown): BankRecord[] {
  return parsePayload(body, parseBankRecord);
}

export function parseFailuresPayload(body: unknown): BankFailure[] {
  return parsePayload(body, parseFailureRecord);
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fdicFetch.fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`FDIC BankFind request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export class FdicBankClient {
  /**
   * Search the bank directory and the failure record together. An empty
   * query skips the 27k-row directory and returns only the newest failures.
   */
  async searchRisk(query: string, signal?: AbortSignal): Promise<BankRiskPage> {
    const trimmed = query.trim();
    const [banks, failures] = await Promise.all([
      trimmed
        ? withConnectionRequest(FDIC_BANK_CONNECTION_ID, "institutions", () =>
            fetchJson(buildInstitutionsUrl(trimmed), signal).then(parseInstitutionsPayload),
          )
        : Promise.resolve([]),
      withConnectionRequest(FDIC_BANK_CONNECTION_ID, "failures", () =>
        fetchJson(buildFailuresUrl(trimmed), signal).then(parseFailuresPayload),
      ),
    ]);
    return { banks, failures };
  }
}
