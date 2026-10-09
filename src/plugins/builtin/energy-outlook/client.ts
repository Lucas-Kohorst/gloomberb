import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import {
  importRows,
  outageRows,
  outlookRows,
  OUTLOOK_SERIES,
  type EnergyTab,
  type ImportRow,
  type OutageRow,
  type OutlookRow,
} from "./model";

/** Public demo credential. The service expects it on every request. */
const EIA_API_KEY = "DEMO_KEY";
const EIA_ROOT = "https://api.eia.gov/v2";
/** JSON responses above this size are refused. Every request stays under it. */
const ROW_CAP = 5_000;
/** Newest month and the one before it, per series, so a shorter series is not crowded out. */
const OUTLOOK_LENGTH = 2;
/** One month of country-by-district rows. Pages stay far under the row cap. */
const IMPORT_PAGE_LENGTH = 1_000;
const IMPORT_ROW_CAP = 3_000;
/** One day of plants, plus a few rows of the day before that the newest period drops. */
const FACILITY_LENGTH = 200;
const US_OUTAGE_LENGTH = 2;

const OUTLOOK_FAILURE = "The outlook could not be loaded.";
const IMPORT_FAILURE = "Crude import volumes could not be loaded.";
const IMPORT_RANK_FAILURE = "Crude import volumes could not be ranked.";
const OUTAGE_FAILURE = "Nuclear outage figures could not be loaded.";

const eiaFetch = createThrottledFetch({
  requestsPerMinute: 20,
  // The shared demo key answers 429 with a long retry-after. Waiting it out stalls the pane.
  maxRetries: 0,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: { Accept: "application/json" },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

export interface EiaRecord {
  period: string;
  fields: Record<string, string>;
}

interface EiaPage {
  rows: EiaRecord[];
  total: number | null;
}

export interface OutlookSection {
  rows: OutlookRow[];
  error: string | null;
}

export interface ImportSection {
  rows: ImportRow[];
  period: string | null;
  error: string | null;
}

export interface OutageSection {
  available: boolean;
  rows: OutageRow[];
  period: string | null;
  error: string | null;
}

export interface EnergyOutlookData {
  outlook: OutlookSection;
  imports: ImportSection;
  outages: OutageSection;
}

class RouteMissingError extends Error {
  constructor() {
    super("Route missing.");
    this.name = "RouteMissingError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fieldText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function aborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() && !(error instanceof RouteMissingError)
    ? error.message
    : fallback;
}

function readTotal(payload: unknown): number | null {
  const total = asRecord(asRecord(payload)?.response)?.total;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  if (typeof total === "string" && /^\d+$/.test(total)) return Number(total);
  return null;
}

/** Rows from a `response.data` array. Anything else is an empty page. */
export function parseEiaData(payload: unknown): EiaRecord[] {
  const data = asRecord(asRecord(payload)?.response)?.data;
  if (!Array.isArray(data)) return [];
  const rows: EiaRecord[] = [];
  for (const item of data) {
    const record = asRecord(item);
    const period = fieldText(record?.period);
    if (!record || !period) continue;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "period") continue;
      const text = fieldText(value);
      if (text) fields[key] = text;
    }
    rows.push({ period, fields });
  }
  return rows;
}

function assertShort(length: number): number {
  if (length >= ROW_CAP) throw new Error("The request asks for too many rows.");
  return length;
}

export function outlookDataUrl(seriesId: string | readonly string[]): string {
  const ids = typeof seriesId === "string" ? [seriesId] : seriesId;
  if (ids.length === 0) throw new Error("An outlook series is required.");
  // length counts rows, not series. Two months times the series, or the page is only the first series.
  const length = assertShort(OUTLOOK_LENGTH * ids.length);
  const facets = ids.map((id) => `facets[seriesId][]=${encodeURIComponent(id)}`).join("&");
  return `${EIA_ROOT}/steo/data/?frequency=monthly&data[0]=value&${facets}&sort[0][column]=period&sort[0][direction]=desc&length=${length}&api_key=${EIA_API_KEY}`;
}

export function importDataUrl(options: { length: number; offset?: number; period?: string }): string {
  const length = assertShort(options.length);
  const range = options.period ? `&start=${options.period}&end=${options.period}` : "";
  const offset = options.offset ? `&offset=${options.offset}` : "";
  // Port districts partition the month. State and refinery rows repeat those barrels.
  return `${EIA_ROOT}/crude-oil-imports/data/?frequency=monthly&data[0]=quantity&facets[originType][]=CTY&facets[destinationType][]=PP${range}&sort[0][column]=period&sort[0][direction]=desc${offset}&length=${length}&api_key=${EIA_API_KEY}`;
}

export function outageDataUrl(route: "facility-nuclear-outages" | "us-nuclear-outages", length: number): string {
  return `${EIA_ROOT}/nuclear-outages/${route}/data/?frequency=daily&data[0]=capacity&data[1]=outage&data[2]=percentOutage&sort[0][column]=period&sort[0][direction]=desc&length=${assertShort(length)}&api_key=${EIA_API_KEY}`;
}

async function loadRoute(url: string, failure: string, signal?: AbortSignal): Promise<EiaPage> {
  let response: Response;
  try {
    response = await eiaFetch.fetch(url, signal ? { signal } : undefined);
  } catch (error) {
    if (aborted(error)) throw error;
    throw new Error(failure);
  }
  if (response.status === 404) throw new RouteMissingError();
  if (!response.ok) throw new Error(failure);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (aborted(error)) throw error;
    throw new Error(failure);
  }
  return { rows: parseEiaData(payload), total: readTotal(payload) };
}

async function loadOutlook(signal?: AbortSignal): Promise<OutlookSection> {
  try {
    const page = await loadRoute(outlookDataUrl(OUTLOOK_SERIES.map((series) => series.id)), OUTLOOK_FAILURE, signal);
    return { rows: outlookRows(page.rows), error: null };
  } catch (error) {
    if (aborted(error)) throw error;
    return { rows: [], error: failureMessage(error, OUTLOOK_FAILURE) };
  }
}

async function loadImports(signal?: AbortSignal): Promise<ImportSection> {
  try {
    const probe = await loadRoute(importDataUrl({ length: 1 }), IMPORT_FAILURE, signal);
    const period = probe.rows[0]?.period ?? null;
    if (!period) return { rows: [], period: null, error: null };
    const rows: EiaRecord[] = [];
    let total: number | null = null;
    let offset = 0;
    while (rows.length < IMPORT_ROW_CAP) {
      const page = await loadRoute(importDataUrl({ length: IMPORT_PAGE_LENGTH, offset, period }), IMPORT_FAILURE, signal);
      total = page.total;
      if (page.rows.length === 0) break;
      rows.push(...page.rows);
      offset += page.rows.length;
      if (page.rows.length < IMPORT_PAGE_LENGTH || (total != null && rows.length >= total)) break;
    }
    const incomplete = total == null ? rows.length >= IMPORT_ROW_CAP : rows.length < total;
    if (incomplete) return { rows: [], period, error: IMPORT_RANK_FAILURE };
    return { rows: importRows(rows), period, error: null };
  } catch (error) {
    if (aborted(error)) throw error;
    return { rows: [], period: null, error: failureMessage(error, IMPORT_FAILURE) };
  }
}

async function loadOutageRoute(
  route: "facility-nuclear-outages" | "us-nuclear-outages",
  length: number,
  signal?: AbortSignal,
): Promise<OutageSection> {
  const page = await loadRoute(outageDataUrl(route, length), OUTAGE_FAILURE, signal);
  const rows = outageRows(page.rows);
  return { available: true, rows, period: rows[0]?.period ?? null, error: null };
}

async function loadOutages(signal?: AbortSignal): Promise<OutageSection> {
  try {
    return await loadOutageRoute("facility-nuclear-outages", FACILITY_LENGTH, signal);
  } catch (error) {
    if (aborted(error)) throw error;
    if (!(error instanceof RouteMissingError)) {
      return { available: true, rows: [], period: null, error: failureMessage(error, OUTAGE_FAILURE) };
    }
  }
  try {
    return await loadOutageRoute("us-nuclear-outages", US_OUTAGE_LENGTH, signal);
  } catch (error) {
    if (aborted(error)) throw error;
    if (error instanceof RouteMissingError) return { available: false, rows: [], period: null, error: null };
    return { available: true, rows: [], period: null, error: failureMessage(error, OUTAGE_FAILURE) };
  }
}

let lastBoard: EnergyOutlookData | null = null;

function retainRows<T extends { rows: readonly unknown[]; error: string | null }>(next: T, previous: T | undefined): T {
  if (next.error && previous && previous.rows.length > 0) return { ...previous, error: next.error };
  return next;
}

/** One section per call. The shared demo key rejects a burst of every section at once. */
export async function fetchEnergyOutlook(signal?: AbortSignal, tab: EnergyTab = "outlook"): Promise<EnergyOutlookData> {
  const outlook = tab === "outlook"
    ? retainRows(await loadOutlook(signal), lastBoard?.outlook)
    : lastBoard?.outlook ?? { rows: [], error: null };
  const imports = tab === "imports"
    ? retainRows(await loadImports(signal), lastBoard?.imports)
    : lastBoard?.imports ?? { rows: [], period: null, error: null };
  const freshOutages = tab === "outages" ? await loadOutages(signal) : null;
  const outages = freshOutages == null
    ? lastBoard?.outages ?? { available: true, rows: [], period: null, error: null }
    : !freshOutages.available
      ? freshOutages
      : retainRows(freshOutages, lastBoard?.outages.available ? lastBoard.outages : undefined);
  const board: EnergyOutlookData = { outlook, imports, outages };
  lastBoard = board;
  return board;
}
