import { apiClient } from "../../../api-client";
import { ApiRequestError, parseApiErrorMessage } from "../../../api-client/errors";
import { getCloudApiBaseUrl } from "../../../api-client/request";
import type { RatePathPayload } from "../../../api-client/rates";
import type { PluginPersistence } from "../../../types/plugin";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";

export const RATE_PATH_CONNECTION_ID = "gloom-cloud-rate-path";
const PATH = "/cloud/econ/rate-path";
const CACHE_KEY = "usd";

export interface RatePathEndpoint {
  getCloudRatePath(): Promise<RatePathPayload>;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

interface LoadResult<T> {
  data: T;
  stale: boolean;
  refreshError: string | null;
}

const STALE_MS = 60_000;
const EXPIRE_MS = 24 * 60 * 60_000;

function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

/** A route the server does not serve yet stays actionable; auth errors pass through. */
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
  const inflight = new Map<string, Promise<LoadResult<T>>>();

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
    get(key: string, options?: { allowExpired?: boolean }): CacheEntry<T> | null {
      return read(key, options?.allowExpired ?? false);
    },
    load(key: string, loader: () => Promise<T>, options?: { force?: boolean }): Promise<LoadResult<T>> {
      if (!options?.force) {
        const cached = read(key, false);
        if (cached && !cached.stale) return Promise.resolve({ data: cached.data, stale: false, refreshError: null });
      }
      const pending = inflight.get(key);
      if (pending) return pending;
      const request = (async () => {
        try {
          const data = await loader();
          memory.set(key, { data, fetchedAt: Date.now() });
          persistence?.setResource(kind, key, data, {
            sourceKey: "gloom-cloud",
            schemaVersion: 1,
            cachePolicy: { staleMs: STALE_MS, expireMs: EXPIRE_MS },
          });
          return { data, stale: false, refreshError: null };
        } catch (error) {
          if (isAccessDenied(error)) throw error;
          const fallback = read(key, true);
          if (!fallback) throw error;
          return {
            data: fallback.data,
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

export const ratePathCache = createBundleCache<RatePathPayload>("rate-path");

const numberOrNull = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value);

export function validateRatePath(payload: RatePathPayload): RatePathPayload {
  if (!payload || !Array.isArray(payload.meetings) || !Array.isArray(payload.fedFunds)
    || !Array.isArray(payload.sofr) || !Array.isArray(payload.ghosts) || !Array.isArray(payload.gaps)
    || !payload.current?.effr || !payload.current.targetLower || !payload.current.targetUpper
    || !payload.dotPlot || !Array.isArray(payload.dotPlot.points) || !payload.schedule
    || !Number.isFinite(Date.parse(payload.fetchedAt))) {
    throw new Error("The server returned an invalid rate path");
  }
  for (const row of [...payload.meetings, ...payload.fedFunds, ...payload.sofr]) {
    if (!numberOrNull(row.impliedRate) || !numberOrNull(row.percentile) || !Number.isInteger(row.samples)) {
      throw new Error("The server returned an invalid rate observation");
    }
  }
  for (const meeting of payload.meetings) {
    const date = Date.parse(meeting.date);
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== meeting.date
      || !Array.isArray(meeting.probabilities)
      || meeting.probabilities.some((point) => !Number.isFinite(point.targetMidpoint)
        || !Number.isFinite(point.probability) || point.probability < 0 || point.probability > 1)
      || meeting.probabilities.length > 0 && Math.abs(meeting.probabilities.reduce((sum, point) => sum + point.probability, 0) - 1) > 1e-6) {
      throw new Error("The server returned invalid meeting probabilities");
    }
  }
  return payload;
}

const cloudRatePath: RatePathEndpoint = {
  getCloudRatePath: () => withConnectionRequest(
    RATE_PATH_CONNECTION_ID,
    "GET /cloud/econ/rate-path",
    () => getCloudJson<RatePathPayload>(PATH),
  ),
};

export async function fetchRatePath(client: RatePathEndpoint = cloudRatePath): Promise<RatePathPayload> {
  try {
    return validateRatePath(await client.getCloudRatePath());
  } catch (error) {
    throw unavailableOnServer(error, "Rate path is not available yet.");
  }
}

export function getCachedRatePath(): RatePathPayload | null {
  return ratePathCache.get(CACHE_KEY, { allowExpired: true })?.data ?? null;
}

export async function loadRatePath(force = false): Promise<RatePathPayload> {
  const { data, stale, refreshError } = await ratePathCache.load(CACHE_KEY, () => fetchRatePath(), { force });
  return {
    ...data,
    stale: stale || data.stale,
    gaps: [...data.gaps, ...(refreshError ? [refreshError] : [])],
  };
}
