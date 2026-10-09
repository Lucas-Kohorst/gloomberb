import { httpFetch } from "../../../utils/http-transport";
import type { CanadaListing } from "./model";

const LISTINGS_URL = "https://app-money.tmx.com/graphql";
const FETCH_TIMEOUT_MS = 15_000;
const BOARD_LIMIT = 50;

const MOVERS_QUERY = `query getMarketMovers($sortOrder: String!, $statExchange: String!, $limit: Int) {
  getMarketMovers(sortOrder: $sortOrder, statExchange: $statExchange, limit: $limit) {
    symbol
    name
    price
    priceChange
    percentChange
    volume
  }
}`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Abort on the caller's signal or the timeout. AbortSignal.any is missing on older desktop webviews. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted || timeout.aborted) {
    abort();
    return controller.signal;
  }
  signal.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function listingsError(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.errors) || payload.errors.length === 0) return null;
  const message = payload.errors
    .map((error) => asText(asRecord(error)?.message))
    .filter(Boolean)
    .join("; ");
  return message || "Canada listings request failed";
}

/**
 * Most active Toronto listings by session volume.
 * `percentChange` is already in percent points.
 */
export function parseCanadaListings(payload: unknown): CanadaListing[] {
  const record = asRecord(payload);
  if (!record) throw new Error("Canada listings response was not a listings board");
  const failure = listingsError(record);
  if (failure) throw new Error(failure);
  const data = asRecord(record.data) ?? record;
  const rows = data.getMarketMovers;
  if (!Array.isArray(rows)) throw new Error("Canada listings response was not a listings board");

  const listings: CanadaListing[] = [];
  for (const row of rows) {
    const item = asRecord(row);
    const symbol = asText(item?.symbol).toUpperCase();
    if (!symbol) continue;
    listings.push({
      symbol,
      name: asText(item?.name),
      last: asNumber(item?.price),
      change: asNumber(item?.priceChange),
      changePercent: asNumber(item?.percentChange),
      volume: asNumber(item?.volume),
    });
  }
  return listings;
}

export async function fetchCanadaListings(signal?: AbortSignal): Promise<CanadaListing[]> {
  const response = await httpFetch(LISTINGS_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      locale: "en",
    },
    body: JSON.stringify({
      operationName: "getMarketMovers",
      variables: { sortOrder: "desc", statExchange: "TSX", limit: BOARD_LIMIT },
      query: MOVERS_QUERY,
    }),
    signal: withTimeout(signal, FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Canada listings request failed (${response.status})`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Canada listings response was not JSON");
  }
  return parseCanadaListings(payload);
}
