import { apiClient } from "../../../api-client";
import { ApiRequestError, parseApiErrorMessage } from "../../../api-client/errors";
import { getCloudApiBaseUrl } from "../../../api-client/request";
import type { MoneyMarketsPayload } from "../../../api-client/money-markets";
import type { PluginPersistence } from "../../../types/plugin";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";

export const MONEY_MARKETS_CONNECTION_ID = "gloom-cloud-money-markets";
const PATH = "/cloud/econ/money-markets";
const CACHE_KEY = "usd";

export interface MoneyMarketsEndpoint {
  getCloudMoneyMarkets(): Promise<MoneyMarketsPayload>;
}

export interface MoneyMarketsResource {
  payload: MoneyMarketsPayload;
  stale: boolean;
  refreshError: string | null;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

interface BundleResource<T> {
  payload: T;
  stale: boolean;
  refreshError: string | null;
}

const STALE_MS = 60 * 60_000;
const EXPIRE_MS = 7 * 24 * 60 * 60_000;

function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

function unavailableOnServer(error: unknown, message: string): unknown {
  return error instanceof ApiRequestError && error.status === 404 ? new Error(message) : error;
}

function sessionHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = apiClient.getSessionToken();
  if (token && token !== "hosted-session") {
    headers.Cookie = `__Secure-gloomberb.session_token=${token}; gloomberb.session_token=${token}`;
  }
  return headers;
}

async function getCloudJson<T>(path: string): Promise<T> {
  const response = await httpFetch(`${getCloudApiBaseUrl()}${path}`, {
    headers: sessionHeaders(),
    credentials: "include",
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ApiRequestError(parseApiErrorMessage(text) || response.statusText, response.status);
  }
  return JSON.parse(text) as T;
}

function createBundleCache<T>(kind: string) {
  let persistence: PluginPersistence | null = null;
  const memory = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<BundleResource<T>>>();

  const read = (key: string, allowExpired: boolean): (CacheEntry<T> & { stale: boolean }) | null => {
    const cached = memory.get(key);
    if (cached) {
      const age = Date.now() - cached.fetchedAt;
      if (!allowExpired && age >= EXPIRE_MS) return null;
      return { ...cached, stale: age >= STALE_MS };
    }
    const record = persistence?.getResource<T>(kind, key, {
      sourceKey: "gloom-cloud",
      schemaVersion: 1,
      allowExpired,
    });
    if (!record) return null;
    return { data: record.value, fetchedAt: record.fetchedAt, stale: !!record.stale };
  };

  return {
    attach(next: PluginPersistence) {
      if (persistence !== next) {
        persistence = next;
        memory.clear();
        inflight.clear();
      }
    },
    reset() {
      persistence = null;
      memory.clear();
      inflight.clear();
    },
    get(key: string, allowExpired = false) {
      return read(key, allowExpired);
    },
    load(key: string, loader: () => Promise<T>, options?: { force?: boolean }): Promise<BundleResource<T>> {
      if (!options?.force) {
        const cached = read(key, false);
        if (cached && !cached.stale) {
          return Promise.resolve({ payload: cached.data, stale: false, refreshError: null });
        }
      }
      const pending = inflight.get(key);
      if (pending) return pending;
      const request = (async () => {
        try {
          const payload = await loader();
          memory.set(key, { data: payload, fetchedAt: Date.now() });
          persistence?.setResource(kind, key, payload, {
            sourceKey: "gloom-cloud",
            schemaVersion: 1,
            cachePolicy: { staleMs: STALE_MS, expireMs: EXPIRE_MS },
          });
          return { payload, stale: false, refreshError: null };
        } catch (error) {
          if (isAccessDenied(error)) throw error;
          const fallback = read(key, true);
          if (!fallback) throw error;
          return {
            payload: fallback.data,
            stale: true,
            refreshError: error instanceof Error ? error.message : String(error),
          };
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, request);
      return request;
    },
  };
}

export const moneyMarketsCache = createBundleCache<MoneyMarketsPayload>("money-markets");

const finiteOrNull = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value);
const dateOrNull = (value: unknown) => value === null || typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Reject incompatible contracts rather than supplying zeros to a board or curve. */
export function validateMoneyMarkets(payload: MoneyMarketsPayload): MoneyMarketsPayload {
  const invalid = () => {
    throw new Error("The server returned invalid money-market observations");
  };
  if (!payload || !Number.isFinite(Date.parse(payload.generatedAt)) || !["available", "partial", "unavailable"].includes(payload.status)
    || !Array.isArray(payload.rows) || !payload.netLiquidity || !payload.billsCurve || !Array.isArray(payload.billsCurve.comparisons)
    || payload.billsCurve.basis !== "discount" || !["available", "stale", "unavailable"].includes(payload.billsCurve.status)) return invalid();
  const rows = [...payload.rows, payload.netLiquidity];
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return invalid();
  for (const row of rows) {
    if (typeof row.id !== "string" || typeof row.label !== "string" || !["rates", "bills", "liquidity"].includes(row.group)
      || !["percent", "usd-billions"].includes(row.unit) || !["daily", "weekly"].includes(row.frequency)
      || !["available", "stale", "unavailable"].includes(row.status)
      || row.changeUnit !== (row.unit === "percent" ? "basis-points" : "usd-billions")
      || !finiteOrNull(row.value) || !finiteOrNull(row.change) || !finiteOrNull(row.previousValue)
      || !dateOrNull(row.asOf) || !dateOrNull(row.previousAsOf) || row.value != null && row.asOf == null
      || !Array.isArray(row.history) || row.history.some((point) => point.date == null || !dateOrNull(point.date) || !finiteOrNull(point.value))
      || !Array.isArray(row.sourceSeriesIds) || row.sourceSeriesIds.some((id) => typeof id !== "string") || !Array.isArray(row.notes)) return invalid();
  }
  for (const stats of [...rows.map((row) => row.percentile), payload.billsCurve.slope?.percentile]) {
    if (!stats || !finiteOrNull(stats.value) || stats.value != null && (stats.value < 0 || stats.value > 100)
      || !Number.isInteger(stats.sampleCount) || stats.sampleCount < 0
      || !finiteOrNull(stats.min) || !finiteOrNull(stats.max) || !finiteOrNull(stats.mean)
      || !dateOrNull(stats.windowStart) || !dateOrNull(stats.windowEnd)) return invalid();
  }
  for (const snapshot of [payload.billsCurve, ...payload.billsCurve.comparisons]) {
    if (!dateOrNull(snapshot.asOf) || !Array.isArray(snapshot.points) || snapshot.points.some((point) =>
      !Number.isFinite(point.value) || !Number.isFinite(point.maturityYears) || point.maturityYears <= 0
      || typeof point.tenor !== "string") || snapshot.points.length > 0 && snapshot.asOf == null) return invalid();
  }
  if (!finiteOrNull(payload.billsCurve.slope.valueBps) || !dateOrNull(payload.billsCurve.slope.asOf)) return invalid();
  return payload;
}

const cloudMoneyMarkets: MoneyMarketsEndpoint = {
  getCloudMoneyMarkets: () => withConnectionRequest(
    MONEY_MARKETS_CONNECTION_ID,
    "GET /cloud/econ/money-markets",
    () => getCloudJson<MoneyMarketsPayload>(PATH),
  ),
};

export async function fetchMoneyMarkets(client: MoneyMarketsEndpoint = cloudMoneyMarkets): Promise<MoneyMarketsPayload> {
  try {
    return validateMoneyMarkets(await client.getCloudMoneyMarkets());
  } catch (error) {
    throw unavailableOnServer(error, "Money markets are not available yet.");
  }
}

export function getCachedMoneyMarkets(): MoneyMarketsResource | null {
  const cached = moneyMarketsCache.get(CACHE_KEY, true);
  if (!cached) return null;
  try {
    return { payload: validateMoneyMarkets(cached.data), stale: false, refreshError: null };
  } catch {
    return null;
  }
}

export function loadMoneyMarkets(force = false): Promise<MoneyMarketsResource> {
  return moneyMarketsCache.load(CACHE_KEY, () => fetchMoneyMarkets(), { force });
}
