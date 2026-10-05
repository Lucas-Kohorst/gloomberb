import { canonicalExchange, normalizeSymbol } from "../../../utils/exchanges";
import { apiClient } from "../../../api-client";
import { ApiRequestError } from "../../../api-client/errors";
import type { CloudHistoryParams } from "../../../api-client/paths";
import type {
  CloudMarketResponse,
  CloudPricePointPayload,
  CloudQuotePayload,
} from "../../../api-client/types";
import { withConnectionRequest } from "../connections/register";
import {
  buildRotation,
  rotationId,
  type RotationHistory,
  type RotationInstrument,
  type RotationPayload,
} from "./model";

export const ROTATION_CONNECTION_ID = "gloom-cloud-relative-rotation";

interface CacheRow<T> { data: T; at: number }

function createRotationCache<T>(staleMs: number) {
  const store = new Map<string, CacheRow<T>>();
  return {
    attach(_persistence: unknown) {},
    reset() { store.clear(); },
    get(key: string) {
      const row = store.get(key);
      if (!row) return null;
      return { data: row.data, stale: Date.now() - row.at > staleMs };
    },
    async load(key: string, loader: () => Promise<T>, options?: { force?: boolean }) {
      const current = store.get(key);
      const fresh = !!current && Date.now() - current.at <= staleMs;
      if (current && fresh && !options?.force) return { data: current.data, stale: false, refreshError: null as string | null, error: null as unknown };
      try {
        const data = await loader();
        store.set(key, { data, at: Date.now() });
        return { data, stale: false, refreshError: null as string | null, error: null as unknown };
      } catch (error) {
        if (current) return { data: current.data, stale: true, refreshError: error instanceof Error ? error.message : String(error), error };
        throw error;
      }
    },
  };
}

export const rotationCache = createRotationCache<RotationPayload>(30 * 60_000);

function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

export interface RotationClient {
  getCloudHistory(symbol: string, exchange: string, params?: CloudHistoryParams): Promise<CloudMarketResponse<CloudPricePointPayload[]>>;
  getCloudQuotesBatch(targets: RotationInstrument[], mode?: "cache-first" | "refresh"): Promise<CloudMarketResponse<{ items: Array<{ symbol: string; exchange?: string; status: string; data?: CloudQuotePayload | null }> }>>;
}

const liveClient: RotationClient = {
  getCloudHistory: (symbol, exchange, params) => withConnectionRequest(
    ROTATION_CONNECTION_ID,
    "history",
    () => apiClient.getCloudHistory(symbol, exchange, params),
  ),
  getCloudQuotesBatch: (targets, mode) => withConnectionRequest(
    ROTATION_CONNECTION_ID,
    "quotes",
    () => apiClient.getCloudQuotesBatch(targets, mode),
  ),
};
export function validateRotationHistory(
  response: CloudMarketResponse<CloudPricePointPayload[]>,
  instrument?: RotationInstrument,
  currency?: string | null,
): CloudPricePointPayload[] {
  if (
    response.status !== "success" ||
    !Array.isArray(response.data) ||
    !response.data.length
  )
    throw new Error(response.reasonCode ?? "Daily history unavailable.");
  if (
    response.providerMeta?.servedResolution &&
    !["1d", "1day"].includes(response.providerMeta.servedResolution)
  )
    throw new Error("Cloud did not return daily bars.");
  const metadata = response.providerMeta;
  if (
    instrument &&
    ((metadata?.normalizedSymbol &&
      normalizeSymbol(metadata.normalizedSymbol) !==
        normalizeSymbol(instrument.symbol)) ||
      (metadata?.normalizedExchange &&
        instrument.exchange &&
        canonicalExchange(metadata.normalizedExchange) !==
          canonicalExchange(instrument.exchange)))
  )
    throw new Error(
      "History listing identity does not match the requested instrument.",
    );
  const units = [response.currency, metadata?.currency].filter(
    (value): value is string => !!value,
  );
  if (currency && units.some((value) => value !== currency))
    throw new Error("History currency does not match the listing currency.");
  if (
    response.data.length > 1500 ||
    response.data.some(
      (row) =>
        !row ||
        typeof row.date !== "string" ||
        !Number.isFinite(Date.parse(row.date)) ||
        !Number.isFinite(row.close) ||
        row.close <= 0,
    )
  )
    throw new Error("Invalid daily history.");
  return response.data;
}
export async function fetchRotation(
  benchmark: RotationInstrument,
  instruments: RotationInstrument[],
  trail = 6,
  client: RotationClient = liveClient,
  now = new Date(),
): Promise<RotationPayload> {
  const unique = [
    ...new Map(
      [benchmark, ...instruments].map((row) => [rotationId(row), row]),
    ).values(),
  ];
  const quotes = new Map<string, CloudQuotePayload>();
  let quoteError: string | null = null;
  try {
    const result = await client.getCloudQuotesBatch(unique, "cache-first");
    for (const item of result.data?.items ?? []) {
      const instrument = unique.find(
        (row) =>
          row.symbol === item.symbol &&
          (canonicalExchange(row.exchange) ===
            canonicalExchange(item.exchange) ||
            !row.exchange),
      );
      if (instrument && item.status === "success" && item.data)
        quotes.set(rotationId(instrument), item.data);
    }
  } catch (error) {
    if (isAccessDenied(error)) throw error;
    quoteError = "Listing currencies unavailable.";
  }
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  start.setUTCDate(1);
  const end = now.toISOString().slice(0, 10),
    startDate = start.toISOString().slice(0, 10);
  const results = new Map<string, RotationHistory>();
  let next = 0;
  // Bound Cloud history requests; shared server caches batch upstream demand.
  await Promise.all(
    Array.from({ length: Math.min(4, unique.length) }, async () => {
      while (next < unique.length) {
        const instrument = unique[next++]!,
          id = rotationId(instrument),
          currency = quotes.get(id)?.currency ?? null;
        try {
          const response = await client.getCloudHistory(
            instrument.symbol,
            instrument.exchange,
            {
              interval: "1day",
              outputsize: 1000,
              startDate,
              endDate: end,
              rangeKey: "3Y",
            },
          );
          results.set(id, {
            instrument,
            currency,
            points: validateRotationHistory(response, instrument, currency),
            asOf: response.asOf ?? null,
            stale: response.stale === true,
            error: quoteError,
          });
        } catch (error) {
          if (isAccessDenied(error)) throw error;
          results.set(id, {
            instrument,
            currency,
            points: [],
            asOf: null,
            stale: false,
            error:
              error instanceof Error ? error.message : "History unavailable.",
          });
        }
      }
    }),
  );
  return buildRotation(
    results.get(rotationId(benchmark))!,
    instruments.map((row) => results.get(rotationId(row))!),
    trail,
    now,
  );
}
const key = (
  benchmark: RotationInstrument,
  instruments: RotationInstrument[],
  trail: number,
) =>
  `${rotationId(benchmark)}|${instruments.map(rotationId).join(",")}|${trail}`;
export interface CachedRotation {
  payload: RotationPayload;
  stale: boolean;
  refreshError: string | null;
}

export function cachedRotation(
  benchmark: RotationInstrument,
  instruments: RotationInstrument[],
  trail: number,
): CachedRotation | null {
  const cached = rotationCache.get(key(benchmark, instruments, trail));
  return cached ? { payload: cached.data, stale: cached.stale, refreshError: null } : null;
}

export async function loadRotation(
  benchmark: RotationInstrument,
  instruments: RotationInstrument[],
  trail: number,
  force = false,
): Promise<CachedRotation> {
  const result = await rotationCache.load(key(benchmark, instruments, trail), () => fetchRotation(benchmark, instruments, trail), { force });
  if (isAccessDenied(result.error)) throw result.error;
  return { payload: result.data, stale: result.stale, refreshError: result.refreshError };
}
