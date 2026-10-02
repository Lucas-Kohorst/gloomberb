import { ApiRequestError } from "../../../api-client/errors";
import {
  getCloudFuturesCurve,
  getCloudFuturesCurveAsOf,
  type FuturesCurveAsOfPayload,
  type FuturesCurvePayload,
} from "../../../api-client/futures-curve";
import { withConnectionRequest } from "../connections/register";
import { archivedFuturesCurve, curveLookbackDate, normalizeCurveRoot } from "./model";

export const FUTURES_CURVE_CONNECTION_ID = "gloom-cloud-futures-curve";

interface CacheRow<T> { data: T; at: number }

function createCurveCache<T>(staleMs: number) {
  const store = new Map<string, CacheRow<T>>();
  return {
    attach(_persistence: unknown) {},
    reset() { store.clear(); },
    get(key: string, _options?: { allowExpired?: boolean }) {
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

export const futuresCurveCache = createCurveCache<FuturesCurvePayload>(60_000);

function unavailableOnServer(error: unknown, message: string): unknown {
  return error instanceof ApiRequestError && error.status === 404 ? new Error(message) : error;
}

export interface FuturesCurveClient {
  getCloudFuturesCurve(root: string): Promise<FuturesCurvePayload>;
  getCloudFuturesCurveAsOf(root: string, date: string): Promise<FuturesCurveAsOfPayload>;
}

const liveClient: FuturesCurveClient = {
  getCloudFuturesCurve: (root) => withConnectionRequest(FUTURES_CURVE_CONNECTION_ID, "curve", () => getCloudFuturesCurve(root)),
  getCloudFuturesCurveAsOf: (root, date) => withConnectionRequest(FUTURES_CURVE_CONNECTION_ID, "curve-as-of", () => getCloudFuturesCurveAsOf(root, date)),
};
const finiteOrNull = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const date = (value: unknown) => timestamp(value) && new Date(value as string).toISOString().slice(0, 10) === value;
const rank = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

export function validateFuturesCurve(data: FuturesCurvePayload, root: string): FuturesCurvePayload {
  if (!data || data.root !== root || !Array.isArray(data.contracts) || !Array.isArray(data.ghosts)
    || !Array.isArray(data.gaps) || !data.gaps.every((gap) => typeof gap === "string")
    || !data.catalogue || !data.slope || !timestamp(data.fetchedAt)
    || data.asOf !== null && !timestamp(data.asOf)
    || !["gloom", "cboe"].includes(data.source) || !["available", "partial", "unavailable"].includes(data.status)) {
    throw new Error("The server returned an invalid futures curve");
  }
  const symbols = new Set<string>();
  for (const row of data.contracts) {
    if (!row || typeof row.symbol !== "string" || !row.symbol || symbols.has(row.symbol)
      || typeof row.quoteUnit !== "string" || !row.quoteUnit
      || !date(row.expiration) || !finiteOrNull(row.price) || row.change !== undefined && !finiteOrNull(row.change)
      || typeof row.currency !== "string"
      || !rank(row.percentile) || !Number.isInteger(row.samples) || row.samples < 0
      || row.asOf !== null && !timestamp(row.asOf)
      || ![row.volume, row.openInterest, row.delayMinutes].every((value) => finiteOrNull(value) && (value === null || value >= 0))) {
      throw new Error("The server returned an invalid futures contract");
    }
    symbols.add(row.symbol);
  }
  for (const ghost of data.ghosts) {
    if (!["1W", "1M", "1Y"].includes(ghost.label) || !date(ghost.requestedDate)
      || ghost.asOf !== null && !date(ghost.asOf) || !Array.isArray(ghost.points)
      || ghost.points.some((point) => !point || !symbols.has(point.symbol) || !date(point.expiration)
        || !finiteOrNull(point.price) || point.asOf !== null && !date(point.asOf))) {
      throw new Error("The server returned invalid futures history");
    }
  }
  const slope = data.slope;
  if (![slope.value, slope.annualizedRollYield].every(finiteOrNull)
    || ![slope.percentile, slope.rollPercentile].every(rank) || !Number.isInteger(slope.samples) || slope.samples < 0
    || slope.asOf !== null && !timestamp(slope.asOf)) throw new Error("The server returned an invalid futures spread");
  return data;
}

export async function fetchFuturesCurve(root: string, client: Pick<FuturesCurveClient, "getCloudFuturesCurve"> = liveClient): Promise<FuturesCurvePayload> {
  const normalized = normalizeCurveRoot(root);
  if (!normalized) throw new Error(`Unsupported futures root: ${root}`);
  try { return validateFuturesCurve(await client.getCloudFuturesCurve(normalized), normalized); }
  catch (error) { throw unavailableOnServer(error, "Futures curves are not available yet."); }
}

export function getCachedFuturesCurve(root: string): FuturesCurvePayload | null {
  const cached = futuresCurveCache.get(root, { allowExpired: true });
  // The pane revalidates this copy on mount; only the source or a failed refresh makes it stale.
  return cached?.data ?? null;
}

export async function loadFuturesCurve(root: string, force = false): Promise<FuturesCurvePayload> {
  const result = await futuresCurveCache.load(root, () => fetchFuturesCurve(root), { force });
  if (result.error instanceof ApiRequestError && (result.error.status === 401 || result.error.status === 403)) throw result.error;
  return { ...result.data, stale: result.stale || result.data.stale, gaps: [...result.data.gaps, ...(result.refreshError ? [result.refreshError] : [])] };
}

/** The archived curve on a past date with the curves a week and a month before it. */
export async function loadFuturesCurveAsOf(root: string, date: string,
  client: Pick<FuturesCurveClient, "getCloudFuturesCurveAsOf"> = liveClient): Promise<FuturesCurvePayload> {
  const normalized = normalizeCurveRoot(root);
  if (!normalized) throw new Error(`Unsupported futures root: ${root}`);
  try {
    const [curve, week, month] = await Promise.all([
      client.getCloudFuturesCurveAsOf(normalized, date),
      client.getCloudFuturesCurveAsOf(normalized, curveLookbackDate(date, 7)).catch(() => null),
      client.getCloudFuturesCurveAsOf(normalized, curveLookbackDate(date, 30)).catch(() => null),
    ]);
    if (!curve || curve.root !== normalized || !Array.isArray(curve.contracts) || !Array.isArray(curve.gaps)
      || curve.contracts.some((row) => !row || typeof row.symbol !== "string" || !Number.isFinite(row.price))) {
      throw new Error("The server returned an invalid past futures curve");
    }
    return archivedFuturesCurve(normalized, curve, { "1W": week, "1M": month }, new Date().toISOString());
  } catch (error) { throw unavailableOnServer(error, "Past futures curves are not available yet."); }
}
