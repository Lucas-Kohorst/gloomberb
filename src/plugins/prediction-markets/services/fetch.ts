import type { PluginPersistence } from "../../../types/plugin";
import {
  ADJACENT_DATA_ALIAS_ID,
  KALSHI_PROXY_PATH,
  KEYED_DATA_ALIAS_PATH,
  KEYED_DATA_PATH,
} from "../../../shared/hosted-api";
import { httpFetch } from "../../../utils/http-transport";
import { measurePerf } from "../../../utils/perf-marks";
import {
  createThrottledFetch,
} from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../../builtin/connections/register";

const DEFAULT_SOURCE_KEY = "remote";
const PREDICTION_FETCH = createThrottledFetch({
  requestsPerMinute: 120,
  maxRetries: 2,
  timeoutMs: 10_000,
  // An upstream 522 comes back fast, so a 250ms base retried both attempts
  // inside 750ms and surfaced an error banner for a blip that was already over
  // a second later. 750ms spreads the three attempts across ~2.2s instead.
  backoffBaseMs: 750,
  dedupeGetRequests: false,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-prediction-markets",
  },
  transport: httpFetch,
});

export const PREDICTION_CACHE_POLICIES = {
  catalog: { staleMs: 30_000, expireMs: 10 * 60_000 },
  detail: { staleMs: 10_000, expireMs: 5 * 60_000 },
  book: { staleMs: 5_000, expireMs: 30_000 },
  trades: { staleMs: 5_000, expireMs: 2 * 60_000 },
  history: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  rules: { staleMs: 24 * 60 * 60_000, expireMs: 30 * 24 * 60 * 60_000 },
} as const;

let predictionMarketsPersistence: PluginPersistence | null = null;

export function attachPredictionMarketsPersistence(
  persistence: PluginPersistence,
): void {
  predictionMarketsPersistence = persistence;
}

export function resetPredictionMarketsPersistence(): void {
  predictionMarketsPersistence = null;
}

function connectionIdForPredictionUrl(url: string): string | null {
  if (url.includes("kalshi.com") || url.includes(KALSHI_PROXY_PATH)) return "kalshi";
  if (url.includes("polymarket.com")) return "polymarket";
  if (
    url.includes("adjacent.markets")
    || url.includes(`${KEYED_DATA_PATH}/adjacent`)
    || url.includes(`${KEYED_DATA_ALIAS_PATH}/${ADJACENT_DATA_ALIAS_ID}`)
  ) {
    return "adjacent";
  }
  return null;
}

const BLOCKED_REQUEST_MARKER = "ERR_BLOCKED_BY_CLIENT";

/** True when a content blocker, not our server, refused the request. */
export function isBlockedRequestError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(BLOCKED_REQUEST_MARKER);
}

/**
 * True when the hosted Worker/proxy answered with a Cloudflare origin timeout
 * or another 5xx, or the request aborted. Retrying the same Worker path cannot
 * reach Kalshi; the client must switch to Adjacent's public origin instead.
 */
export function isHostedOriginFailureError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isBlockedRequestError(error)) return true;
  const message = error.message;
  if (/Request failed \((401|403|522|524|530|502|503|504)\)/.test(message)) return true;
  return /timed out|timeout|TimeoutError|The operation was aborted/i.test(message);
}

/** Browser transport failures. Chrome/Firefox/Safari each word theirs differently. */
const BROWSER_TRANSPORT_FAILURE = /failed to fetch|load failed|networkerror when attempting to fetch|network request failed/i;

function isSameOriginUrl(url: string): boolean {
  try {
    if (typeof location === "undefined" || !location.origin) return false;
    return new URL(url, location.origin).origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * Chrome reports content-blocker kills as `net::ERR_BLOCKED_BY_CLIENT` in the
 * console but hands JavaScript a bare `TypeError: Failed to fetch`, and the
 * request never reaches the network panel. A same-origin request that fails at
 * the transport layer while the browser believes it is online has not been
 * refused by our server, so an extension or filter list ate it. Naming that
 * matters because, unlike a network blip, it never retries its way to success.
 */
function describeBlockedRequest(url: string, error: unknown): Error | null {
  if (!(error instanceof Error)) return null;
  if (!BROWSER_TRANSPORT_FAILURE.test(error.message)) return null;
  if (!isSameOriginUrl(url)) return null;
  const online = (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine;
  if (online === false) return null;
  return new Error(`Request blocked by the browser (${BLOCKED_REQUEST_MARKER}) for ${url}`);
}

export async function fetchJson<T>(url: string): Promise<T> {
  const connectionId = connectionIdForPredictionUrl(url);
  const run = async (): Promise<T> => {
    let response: Response;
    try {
      response = await PREDICTION_FETCH.fetch(url);
    } catch (error) {
      throw describeBlockedRequest(url, error) ?? error;
    }
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    const body = await response.text();
    return measurePerf(
      "prediction.fetch.parse-json",
      () => JSON.parse(body) as T,
      {
        sizeBytes: body.length,
        url: summarizePredictionFetchUrl(url),
      },
    );
  };
  if (connectionId) {
    return withConnectionRequest(connectionId, "fetch", run);
  }
  return run();
}

export function getCachedPredictionResource<T>(
  kind: string,
  key: string,
  options?: { sourceKey?: string; allowExpired?: boolean },
): T | null {
  const record = predictionMarketsPersistence?.getResource<T>(kind, key, {
    sourceKey: options?.sourceKey ?? DEFAULT_SOURCE_KEY,
    allowExpired: options?.allowExpired,
  });
  return record?.value ?? null;
}

function setCachedPredictionResource<T>(
  kind: string,
  key: string,
  value: T,
  cachePolicy: { staleMs: number; expireMs: number },
  sourceKey = DEFAULT_SOURCE_KEY,
): void {
  predictionMarketsPersistence?.setResource(kind, key, value, {
    sourceKey,
    cachePolicy,
  });
}

export async function loadCachedPredictionResource<T>(
  kind: string,
  key: string,
  fetcher: () => Promise<T>,
  cachePolicy: { staleMs: number; expireMs: number },
  options?: { force?: boolean },
): Promise<T> {
  const cached = predictionMarketsPersistence?.getResource<T>(kind, key, {
    sourceKey: DEFAULT_SOURCE_KEY,
  });
  if (
    !options?.force
    && cached
    && cached.stale !== true
    && cached.staleAt > Date.now()
  ) {
    return cached.value;
  }
  try {
    const nextValue = await fetcher();
    setCachedPredictionResource(kind, key, nextValue, cachePolicy);
    return nextValue;
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
}

function summarizePredictionFetchUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}

export function parseFloatSafe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
