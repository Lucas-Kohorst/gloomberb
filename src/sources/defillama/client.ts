import type { UniversalSeriesLoadResult } from "../../time-series/resolve";
import type { TimeSeriesPoint } from "../../time-series/types";
import { httpFetch } from "../../utils/http-transport";
import { withConnectionRequest } from "../../plugins/builtin/connections/register";

export type DefiLlamaMetric = "tvl" | "fees" | "revenue";

type DefiLlamaKind = "chain" | "protocol";

interface CacheEntry {
  loadedAt: number;
  result: UniversalSeriesLoadResult;
}

const API_BASE_URL = "https://api.llama.fi";
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 32;
const REQUEST_TIMEOUT_MS = 20_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<UniversalSeriesLoadResult>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeDailyPoints(rows: Iterable<readonly [unknown, unknown]>): TimeSeriesPoint[] {
  const byDay = new Map<number, { timestamp: number; value: number }>();
  for (const [rawTimestamp, rawValue] of rows) {
    const timestamp = finiteNonnegative(rawTimestamp);
    const value = finiteNonnegative(rawValue);
    if (timestamp === null || value === null) continue;
    const observed = new Date(timestamp * 1_000);
    if (!Number.isFinite(observed.getTime())) continue;
    const day = Date.UTC(observed.getUTCFullYear(), observed.getUTCMonth(), observed.getUTCDate());
    const previous = byDay.get(day);
    if (!previous || timestamp >= previous.timestamp) byDay.set(day, { timestamp, value });
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => left - right)
    .map(([day, { value }]) => {
      const date = new Date(day);
      return {
        date,
        observedAt: date,
        value,
        provenance: { providerId: "defillama", quality: "reported" },
      };
    });
}

function metricLabel(metric: DefiLlamaMetric): string {
  return metric === "tvl" ? "TVL" : `daily ${metric}`;
}

function fallbackName(slug: string): string {
  return slug.split("-").filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join(" ");
}

function result(points: TimeSeriesPoint[], name: string, metric: DefiLlamaMetric): UniversalSeriesLoadResult {
  if (points.length === 0) {
    throw new Error(`DefiLlama returned no valid ${metric} history for "${name}".`);
  }
  return {
    points,
    label: `${name} ${metricLabel(metric)} (USD)`,
    unit: "USD",
    unitGroup: "currency-total:USD",
  };
}

function parseChainTvl(payload: unknown, slug: string): UniversalSeriesLoadResult {
  const rows = Array.isArray(payload)
    ? payload.map((entry): readonly [unknown, unknown] => (
      isRecord(entry) ? [entry.date, entry.tvl] : [undefined, undefined]
    ))
    : [];
  return result(normalizeDailyPoints(rows), fallbackName(slug), "tvl");
}

function payloadName(payload: Record<string, unknown>, slug: string): string {
  for (const field of [payload.displayName, payload.name]) {
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return fallbackName(slug);
}

function parseProtocolTvl(payload: unknown, slug: string): UniversalSeriesLoadResult {
  if (!isRecord(payload)) return result([], fallbackName(slug), "tvl");
  const rows = Array.isArray(payload.tvl)
    ? payload.tvl.map((entry): readonly [unknown, unknown] => (
      isRecord(entry) ? [entry.date, entry.totalLiquidityUSD] : [undefined, undefined]
    ))
    : [];
  return result(normalizeDailyPoints(rows), payloadName(payload, slug), "tvl");
}

function parseProtocolMetric(
  payload: unknown,
  slug: string,
  metric: Exclude<DefiLlamaMetric, "tvl">,
): UniversalSeriesLoadResult {
  if (!isRecord(payload)) return result([], fallbackName(slug), metric);
  const rows = Array.isArray(payload.totalDataChart)
    ? payload.totalDataChart.map((entry): readonly [unknown, unknown] => (
      Array.isArray(entry) ? [entry[0], entry[1]] : [undefined, undefined]
    ))
    : [];
  return result(normalizeDailyPoints(rows), payloadName(payload, slug), metric);
}

function endpoint(kind: DefiLlamaKind, slug: string, metric: DefiLlamaMetric): string {
  const encodedSlug = encodeURIComponent(slug);
  if (kind === "chain") return `${API_BASE_URL}/v2/historicalChainTvl/${encodedSlug}`;
  if (metric === "tvl") return `${API_BASE_URL}/protocol/${encodedSlug}`;
  const dataType = metric === "fees" ? "dailyFees" : "dailyRevenue";
  return `${API_BASE_URL}/summary/fees/${encodedSlug}?dataType=${dataType}`;
}

async function fetchSeries(
  kind: DefiLlamaKind,
  slug: string,
  metric: DefiLlamaMetric,
): Promise<UniversalSeriesLoadResult> {
  const operation = `${kind}-${metric}`;
  return withConnectionRequest("defillama", operation, async () => {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await httpFetch(endpoint(kind, slug, metric), {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(`DefiLlama ${operation} request failed (${response.status}) for "${slug}".`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      signal.throwIfAborted();
      throw new Error(`DefiLlama ${operation} returned invalid JSON for "${slug}".`);
    }
    if (kind === "chain") return parseChainTvl(payload, slug);
    return metric === "tvl"
      ? parseProtocolTvl(payload, slug)
      : parseProtocolMetric(payload, slug, metric);
  });
}

function readCache(key: string): UniversalSeriesLoadResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.loadedAt >= CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

function writeCache(key: string, value: UniversalSeriesLoadResult): void {
  cache.delete(key);
  cache.set(key, { loadedAt: Date.now(), result: value });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearDefiLlamaSeriesCache(): void {
  cache.clear();
}

export function loadDefiLlamaSeries(
  kind: DefiLlamaKind,
  slug: string,
  metric: DefiLlamaMetric,
): Promise<UniversalSeriesLoadResult> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) return Promise.reject(new Error("DefiLlama requires a chain or protocol slug."));
  if (kind === "chain" && metric !== "tvl") {
    return Promise.reject(new Error("DefiLlama chain series only support TVL."));
  }
  const key = `${kind}:${normalizedSlug}:${metric}`;
  const cached = readCache(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = fetchSeries(kind, normalizedSlug, metric)
    .then((value) => {
      writeCache(key, value);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}
