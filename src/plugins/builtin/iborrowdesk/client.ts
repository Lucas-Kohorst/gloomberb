import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  IBORROWDESK_BASE_URL,
  IBORROWDESK_CONNECTION_ID,
  type BorrowDay,
  type BorrowMover,
  type BorrowMoversPage,
  type BorrowSnapshot,
} from "./types";

const TIMEOUT_MS = 15_000;

const borrowFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 1,
  timeoutMs: TIMEOUT_MS,
  backoffBaseMs: 1000,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asDate(value: unknown): Date {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/**
 * Parse one `/api/ticker/<sym>` payload. Pure — unit tests feed inline
 * fixtures. The endpoint also serves non-symbol payloads (a bare message
 * object when the ticker is unknown), which parse to an empty snapshot.
 */
export function parseSnapshot(symbol: string, payload: unknown): BorrowSnapshot {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const daily = Array.isArray(record.daily) ? record.daily : [];
  const days: BorrowDay[] = [];
  for (const row of daily) {
    if (!row || typeof row !== "object") continue;
    const day = row as Record<string, unknown>;
    const date = String(day.date ?? "").trim();
    const fee = asNumber(day.fee);
    if (!date || fee == null) continue;
    days.push({
      date,
      fee,
      rebate: asNumber(day.rebate),
      available: asNumber(day.available),
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const last = days[days.length - 1] ?? null;
  const name = String(record.name ?? "").trim() || null;
  return {
    symbol: symbol.trim().toUpperCase(),
    name,
    latestFee: last?.fee ?? null,
    available: asNumber(last?.available),
    availableStale: record.available_stale === true,
    country: String(record.country ?? "").trim() || null,
    days,
    updated: asDate(record.country_updated ?? record.updated),
  };
}

/** Parse one fee-movers row. Pure — covered by unit tests. */
export function parseMover(row: Record<string, unknown>): BorrowMover | null {
  const symbol = String(row.symbol ?? "").trim().toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    name: String(row.name ?? "").trim(),
    latestFee: asNumber(row.latest_fee) ?? 0,
    startFee: asNumber(row.start_fee) ?? 0,
    feeChange: asNumber(row.fee_change) ?? 0,
    latestAvailable: asNumber(row.latest_available),
    updated: asDate(row.updated),
  };
}

/** Parse the `/api/fee_movers` payload into its up/down tables. Pure. */
export function parseMoversPayload(payload: unknown): BorrowMoversPage {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const side = (key: string): BorrowMover[] => {
    const rows = Array.isArray(record[key]) ? record[key] : [];
    const movers: BorrowMover[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const mover = parseMover(row as Record<string, unknown>);
      if (mover) movers.push(mover);
    }
    return movers;
  };
  const up = side("fee_increases");
  const down = side("fee_decreases");
  const updated = [...up, ...down]
    .map((mover) => mover.updated)
    .reduce<Date | null>((acc, date) => (date.getTime() > 0 && (!acc || date.getTime() > acc.getTime()) ? date : acc), null);
  return { up, down, updated };
}

export class IBorrowDeskClient {
  /** Borrow snapshot for one symbol (fee history, availability). */
  async getSnapshot(symbol: string, signal?: AbortSignal): Promise<BorrowSnapshot> {
    const sym = symbol.trim().toUpperCase();
    if (!sym) throw new Error("Enter a ticker to load borrow data.");
    return withConnectionRequest(IBORROWDESK_CONNECTION_ID, "snapshot", async () => {
      const response = await borrowFetch.fetch(
        `${IBORROWDESK_BASE_URL}/api/ticker/${encodeURIComponent(sym)}`,
        { ...(signal ? { signal } : {}) },
      );
      if (!response.ok) {
        throw new Error(`IBorrowDesk request failed (${response.status})`);
      }
      const payload: unknown = await response.json();
      return parseSnapshot(sym, payload);
    });
  }

  /** The biggest borrow-fee increases and decreases right now. */
  async getMovers(signal?: AbortSignal): Promise<BorrowMoversPage> {
    return withConnectionRequest(IBORROWDESK_CONNECTION_ID, "movers", async () => {
      const response = await borrowFetch.fetch(
        `${IBORROWDESK_BASE_URL}/api/fee_movers`,
        { ...(signal ? { signal } : {}) },
      );
      if (!response.ok) {
        throw new Error(`IBorrowDesk request failed (${response.status})`);
      }
      const payload: unknown = await response.json();
      return parseMoversPayload(payload);
    });
  }
}
