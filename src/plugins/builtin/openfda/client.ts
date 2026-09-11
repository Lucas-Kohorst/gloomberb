import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  OPENFDA_API_BASE_URL,
  OPENFDA_CONNECTION_ID,
  type OpenFdaDataset,
  type OpenFdaPage,
  type OpenFdaRecord,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

/** Per-endpoint fetch limit; merged results are capped at OPENFDA_DISPLAY_CAP. */
export const OPENFDA_PER_ENDPOINT_LIMIT = 30;
export const OPENFDA_DISPLAY_CAP = 90;

/**
 * openFDA is free with no API key. Stay well under the anonymous rate limit
 * so typing-driven searches never 429 the pane.
 */
const openFdaFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-openfda",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = asString(entry);
    if (text) out.push(text);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** openFDA dates are YYYYMMDD; device dates are sometimes YYYY-MM-DD. */
export function parseOpenFdaDate(value: unknown): Date {
  if (typeof value === "string") {
    const digits = value.replace(/-/g, "");
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(digits);
    if (match) {
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return new Date(0);
}

/** Quote a user query for the openFDA `search` param. */
function quoteQuery(query: string): string {
  return `"${query.replace(/"/g, "").trim()}"`;
}

/** Drug adverse-event search across product, brand, generic, and manufacturer. */
export function buildDrugEventSearch(query: string): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const quoted = quoteQuery(trimmed);
  return [
    `patient.drug.medicinalproduct:${quoted}`,
    `patient.drug.openfda.brand_name:${quoted}`,
    `patient.drug.openfda.generic_name:${quoted}`,
    `patient.drug.openfda.manufacturer_name:${quoted}`,
  ].join("+OR+");
}

/** Device adverse-event search across brand, generic, and manufacturer. */
export function buildDeviceEventSearch(query: string): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const quoted = quoteQuery(trimmed);
  return [
    `device.brand_name:${quoted}`,
    `device.generic_name:${quoted}`,
    `device.manufacturer_d_name:${quoted}`,
  ].join("+OR+");
}

/** Recall (enforcement) search across firm, product, and reason. */
export function buildRecallSearch(query: string): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const quoted = quoteQuery(trimmed);
  return [
    `recalling_firm:${quoted}`,
    `product_description:${quoted}`,
    `reason_for_recall:${quoted}`,
  ].join("+OR+");
}

function endpointUrl(path: string, search: string | undefined, limit: number, sort: string): string {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("limit", String(limit));
  params.set("sort", sort);
  return `${OPENFDA_API_BASE_URL}${path}?${params.toString()}`;
}

function selfUrl(path: string, field: string, id: string): string {
  return `${OPENFDA_API_BASE_URL}${path}?search=${encodeURIComponent(`${field}:"${id}"`)}&limit=1`;
}

function pageTotal(data: unknown, fallback: number): number {
  const meta = asRecord(asRecord(data).meta);
  const results = asRecord(meta.results);
  const total = results.total;
  return typeof total === "number" && Number.isFinite(total) ? total : fallback;
}

function firstOpenFda(drugs: Array<Record<string, unknown>>): Record<string, unknown> {
  for (const drug of drugs) {
    const openfda = asRecord(drug.openfda);
    if (Object.keys(openfda).length > 0) return openfda;
  }
  return {};
}

/** Parse one drug/event.json result into a normalized record. */
export function parseDrugEvent(raw: unknown, index = 0): OpenFdaRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const report = asRecord(raw);
  const id = asString(report.safetyreportid) ?? `drug-${index}`;
  const patient = asRecord(report.patient);

  const drugs = Array.isArray(patient.drug)
    ? patient.drug.map(asRecord)
    : [];
  const openfda = firstOpenFda(drugs);
  const product = asString(drugs[0]?.medicinalproduct)
    ?? asStringArray(openfda.brand_name)[0]
    ?? asStringArray(openfda.generic_name)[0]
    ?? "Unknown product";
  const company = asStringArray(openfda.manufacturer_name)[0] ?? "";

  const reactions = Array.isArray(patient.reaction)
    ? patient.reaction
      .map((entry) => asString(asRecord(entry).reactionmeddrapt))
      .filter((entry): entry is string => !!entry)
    : [];
  const headline = reactions.slice(0, 2).join(", ") || "adverse event";

  const death = asString(report.seriousnessdeath) === "1";
  const serious = asString(report.serious) === "1";
  const flag = death ? "Death" : serious ? "Serious" : "Report";
  const date = parseOpenFdaDate(
    report.receivedate ?? report.receiptdate ?? report.transmissiondate,
  );

  return {
    id: `drug:${id}`,
    dataset: "drug",
    title: `${product} · ${headline}`,
    company,
    product,
    date,
    flag,
    detail: reactions.slice(0, 5),
    url: selfUrl("/drug/event.json", "safetyreportid", id),
  };
}

/** Parse one device/event.json result into a normalized record. */
export function parseDeviceEvent(raw: unknown, index = 0): OpenFdaRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const report = asRecord(raw);
  const key = asString(report.mdr_report_key)
    ?? asString(report.report_number)
    ?? `device-${index}`;
  const devices = Array.isArray(report.device)
    ? report.device.map(asRecord)
    : [];
  const primary = devices[0] ?? {};

  const brand = asString(primary.brand_name);
  const generic = asString(primary.generic_name);
  const product = brand && brand.toUpperCase() !== "N/A"
    ? brand
    : generic ?? "Unknown device";
  const company = asString(primary.manufacturer_d_name) ?? "";
  const eventType = asString(report.event_type) ?? "Event";
  const date = parseOpenFdaDate(report.date_received ?? report.date_added);

  const detail: string[] = [];
  const productCode = asString(primary.device_report_product_code);
  if (productCode) detail.push(`Product code: ${productCode}`);
  const model = asString(primary.model_number);
  if (model && model.toUpperCase() !== "N/A") detail.push(`Model: ${model}`);

  return {
    id: `device:${key}`,
    dataset: "device",
    title: `${product} · ${eventType}`,
    company,
    product,
    date,
    flag: eventType,
    detail,
    url: selfUrl("/device/event.json", "mdr_report_key", key),
  };
}

/** Parse one drug/enforcement.json (recall) result into a normalized record. */
export function parseRecall(raw: unknown, index = 0): OpenFdaRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const report = asRecord(raw);
  const recallNumber = asString(report.recall_number) ?? `recall-${index}`;
  const firm = asString(report.recalling_firm) ?? "";
  const product = asString(report.product_description) ?? "Unknown product";
  const reason = asString(report.reason_for_recall) ?? "";
  const classification = asString(report.classification) ?? "Recall";
  const status = asString(report.status) ?? "";
  const date = parseOpenFdaDate(
    report.recall_initiation_date ?? report.center_classification_date ?? report.report_date,
  );

  return {
    id: `recall:${recallNumber}`,
    dataset: "recall",
    title: `${firm || "Recall"} · ${classification}`,
    company: firm,
    product,
    date,
    flag: status ? `${classification} — ${status}` : classification,
    detail: reason ? [reason] : [],
    url: selfUrl("/drug/enforcement.json", "recall_number", recallNumber),
  };
}

function parseResults(
  data: unknown,
  parse: (raw: unknown, index: number) => OpenFdaRecord | null,
): OpenFdaPage {
  const record = asRecord(data);
  const results = Array.isArray(record.results) ? record.results : [];
  const records: OpenFdaRecord[] = [];
  for (const [index, raw] of results.entries()) {
    const parsed = parse(raw, index);
    if (parsed) records.push(parsed);
  }
  return { records, total: pageTotal(data, records.length) };
}

export function parseDrugEventPage(data: unknown): OpenFdaPage {
  return parseResults(data, parseDrugEvent);
}

export function parseDeviceEventPage(data: unknown): OpenFdaPage {
  return parseResults(data, parseDeviceEvent);
}

export function parseRecallPage(data: unknown): OpenFdaPage {
  return parseResults(data, parseRecall);
}

/** Merge per-dataset pages newest-first, capped for display. */
export function mergeOpenFdaPages(pages: OpenFdaPage[], cap = OPENFDA_DISPLAY_CAP): OpenFdaPage {
  const records = pages.flatMap((page) => page.records);
  records.sort((a, b) => b.date.getTime() - a.date.getTime());
  const total = pages.reduce((sum, page) => sum + page.total, 0);
  return { records: records.slice(0, cap), total };
}

/** openFDA returns 404 when a search matches nothing — treat it as empty. */
async function fetchPage(
  url: string,
  parse: (data: unknown) => OpenFdaPage,
): Promise<OpenFdaPage> {
  const response = await openFdaFetch.fetch(url);
  if (response.status === 404) return { records: [], total: 0 };
  if (!response.ok) {
    throw new Error(`openFDA request failed: ${response.status} ${response.statusText}`);
  }
  return parse(await response.json());
}

export class OpenFdaClient {
  /**
   * Search drug/device adverse events and drug recalls. Every dataset fetch
   * is reported to the Connections pane under the shared openFDA source.
   */
  async listRecords(options: {
    searchQuery?: string;
    limit?: number;
  }): Promise<OpenFdaPage> {
    const query = options.searchQuery?.trim() ?? "";
    const limit = options.limit ?? OPENFDA_PER_ENDPOINT_LIMIT;
    const [drugs, devices, recalls] = await Promise.all([
      withConnectionRequest(OPENFDA_CONNECTION_ID, "drug-event", () =>
        fetchPage(
          endpointUrl("/drug/event.json", buildDrugEventSearch(query), limit, "receivedate:desc"),
          parseDrugEventPage,
        )),
      withConnectionRequest(OPENFDA_CONNECTION_ID, "device-event", () =>
        fetchPage(
          endpointUrl("/device/event.json", buildDeviceEventSearch(query), limit, "date_received:desc"),
          parseDeviceEventPage,
        )),
      withConnectionRequest(OPENFDA_CONNECTION_ID, "drug-recall", () =>
        fetchPage(
          endpointUrl("/drug/enforcement.json", buildRecallSearch(query), limit, "recall_initiation_date:desc"),
          parseRecallPage,
        )),
    ]);
    return mergeOpenFdaPages([drugs, devices, recalls]);
  }
}
