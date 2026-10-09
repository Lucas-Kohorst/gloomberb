import { httpFetch } from "../../../utils/http-transport";
import type { DerivativeCurrency } from "./model";

const BOOK_URL = "https://www.deribit.com/api/v2/public/get_book_summary_by_currency";
const VOLATILITY_URL = "https://www.deribit.com/api/v2/public/get_volatility_index_data";
const FETCH_TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;
/** One day stays inside the endpoint's point cap across a 30-day window. */
const VOL_RESOLUTION = "1D";
const VOL_DAYS = 30;

export interface BookSummary {
  instrument: string;
  last: number | null;
  mark: number | null;
  openInterest: number | null;
  volume: number | null;
  /** 24h price change, already a percent. */
  change: number | null;
  /** Mark implied volatility, already a percent. Absent on futures. */
  markIv: number | null;
  createdAt: number | null;
}

export interface VolatilityLevel {
  level: number;
  timestamp: number;
}

export interface DerivativesSnapshot {
  currency: DerivativeCurrency;
  futures: BookSummary[];
  options: BookSummary[];
  /** Latest book-summary `creation_timestamp`, in milliseconds. */
  bookTime: number | null;
  /** Latest volatility-index close. Null when that call fails or returns no points. */
  index: VolatilityLevel | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bookRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const result = asRecord(payload)?.result;
  if (!Array.isArray(result)) throw new Error("Book summary was not recognized");
  return result;
}

/** Rows of a JSON-RPC book summary. Nameless entries are dropped. */
export function parseBook(payload: unknown): BookSummary[] {
  const rows: BookSummary[] = [];
  for (const item of bookRows(payload)) {
    const row = asRecord(item);
    const instrument = typeof row?.instrument_name === "string" ? row.instrument_name.trim().toUpperCase() : "";
    if (!instrument) continue;
    rows.push({
      instrument,
      last: finite(row?.last),
      mark: finite(row?.mark_price),
      openInterest: finite(row?.open_interest),
      volume: finite(row?.volume),
      change: finite(row?.price_change),
      markIv: finite(row?.mark_iv),
      createdAt: finite(row?.creation_timestamp),
    });
  }
  return rows;
}

interface VolPoint {
  timestamp: number;
  close: number;
}

function parseVolatilityIndex(payload: unknown): VolPoint[] {
  const data = asRecord(asRecord(payload)?.result)?.data;
  if (!Array.isArray(data)) return [];
  const points: VolPoint[] = [];
  for (const item of data) {
    if (!Array.isArray(item) || item.length < 5) continue;
    const timestamp = finite(item[0]);
    const close = finite(item[4]);
    if (timestamp == null || close == null) continue;
    points.push({ timestamp, close });
  }
  return points;
}

function latestLevel(points: readonly VolPoint[]): VolatilityLevel | null {
  let best: VolPoint | null = null;
  for (const point of points) {
    if (!best || point.timestamp >= best.timestamp) best = point;
  }
  return best ? { level: best.close, timestamp: best.timestamp } : null;
}

export function bookSummaryTime(rows: readonly BookSummary[]): number | null {
  let latest: number | null = null;
  for (const row of rows) {
    if (row.createdAt == null) continue;
    if (latest == null || row.createdAt > latest) latest = row.createdAt;
  }
  return latest;
}

function volatilityWindow(now: number): { start_timestamp: number; end_timestamp: number } {
  return { start_timestamp: now - VOL_DAYS * DAY_MS, end_timestamp: now };
}

function bookUrl(currency: DerivativeCurrency, kind: "future" | "option"): string {
  const params = new URLSearchParams({ currency, kind });
  return `${BOOK_URL}?${params.toString()}`;
}

function volatilityUrl(currency: DerivativeCurrency, start: number, end: number): string {
  const params = new URLSearchParams({
    currency,
    start_timestamp: String(start),
    end_timestamp: String(end),
    resolution: VOL_RESOLUTION,
  });
  return `${VOLATILITY_URL}?${params.toString()}`;
}

function rpcFailure(payload: unknown): string | null {
  const error = asRecord(asRecord(payload)?.error);
  if (!error) return null;
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (!message || /deribit/i.test(message)) return "Request failed";
  return message;
}

async function readJson(url: string, failure: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await httpFetch(url, {
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`${failure} (${response.status})`);
  const payload: unknown = await response.json();
  const rpc = rpcFailure(payload);
  if (rpc) throw new Error(rpc);
  return payload;
}

export async function fetchDerivatives(
  currency: DerivativeCurrency,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<DerivativesSnapshot> {
  const window = volatilityWindow(now);
  const [futuresPayload, optionsPayload] = await Promise.all([
    readJson(bookUrl(currency, "future"), "Book summary unavailable", signal),
    readJson(bookUrl(currency, "option"), "Book summary unavailable", signal),
  ]);
  const futures = parseBook(futuresPayload);
  const options = parseBook(optionsPayload);
  let index: VolatilityLevel | null = null;
  try {
    const payload = await readJson(
      volatilityUrl(currency, window.start_timestamp, window.end_timestamp),
      "Volatility index unavailable",
      signal,
    );
    index = latestLevel(parseVolatilityIndex(payload));
  } catch (error) {
    if (signal?.aborted) throw error;
    index = null;
  }
  return {
    currency,
    futures,
    options,
    bookTime: bookSummaryTime([...futures, ...options]),
    index,
  };
}
