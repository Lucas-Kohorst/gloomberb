import { createPluginCache } from "../../../data/plugin-cache";
import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch, type ThrottledFetchTransport } from "../../../utils/throttled-fetch";
import { cachedCloudResource, loadCloudResource } from "../shared/cloud-resource";
import { DOE_WEEKLY_SERIES, type DoeWeeklyRow, type DoeWeeklySeriesId } from "./model";

/** Public demo key. It is a request parameter only and never pane text. */
const WEEKLY_API_KEY = "DEMO_KEY";
const WEEKLY_API_BASE = "https://api.eia.gov/v2";
const WEEKLY_LENGTH = 8;

export interface DoeWeeklyObservation {
  weekEnding: string;
  value: number;
  weekChange: number | null;
}

export interface DoeWeeklySnapshot {
  rows: DoeWeeklyRow[];
  errors: string[];
  stale: boolean;
}

export const doeWeeklyCache = createPluginCache<DoeWeeklyObservation>({
  kind: "doe-weekly", source: "eia", schemaVersion: 1,
  policy: { staleMs: 15 * 60_000, expireMs: 14 * 24 * 60 * 60_000 },
});

const weeklyFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: { Accept: "application/json", "User-Agent": "gloomberb" },
  transport: (url, init) => httpFetch(url, init),
});

type WeeklyDef = typeof DOE_WEEKLY_SERIES[number];

export function doeWeeklyDataUrl(series: WeeklyDef): string {
  const params = new URLSearchParams();
  params.set("api_key", WEEKLY_API_KEY);
  params.set("frequency", "weekly");
  params.set("data[0]", "value");
  params.append("facets[series][]", series.facet);
  params.set("sort[0][column]", "period");
  params.set("sort[0][direction]", "desc");
  params.set("offset", "0");
  params.set("length", String(WEEKLY_LENGTH));
  return `${WEEKLY_API_BASE}/${series.route}/data/?${params.toString()}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asPeriod(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const period = value.trim();
  return new Date(`${period}T00:00:00Z`).toISOString().slice(0, 10) === period ? period : null;
}

/** Newest first. String values are the v2 shape; a blank or non-numeric row is skipped. */
export function parseDoeWeeklyPayload(data: unknown): DoeWeeklyObservation {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const response = record.response && typeof record.response === "object" ? record.response as Record<string, unknown> : {};
  const rows = Array.isArray(response.data) ? response.data : [];
  const points: Array<{ period: string; value: number }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const period = asPeriod(entry.period);
    const value = asNumber(entry.value);
    if (!period || value == null) continue;
    points.push({ period, value });
  }
  points.sort((left, right) => right.period.localeCompare(left.period));
  const latest = points[0];
  if (!latest) throw new Error("No weekly observations");
  const previous = points[1];
  return { weekEnding: latest.period, value: latest.value, weekChange: previous ? latest.value - previous.value : null };
}

function validateObservation(value: DoeWeeklyObservation): DoeWeeklyObservation {
  if (!asPeriod(value?.weekEnding) || !Number.isFinite(value.value)
    || !(value.weekChange == null || Number.isFinite(value.weekChange))) {
    throw new Error("Invalid weekly observation");
  }
  return value;
}

function unavailable(series: WeeklyDef, error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith(series.label) && !message.includes(WEEKLY_API_KEY) && !message.includes("api.eia.gov")) return message;
  return `${series.label} is unavailable`;
}

function emptyRow(series: WeeklyDef, error: string | null, stale = false): DoeWeeklyRow {
  return {
    id: series.id, label: series.label, unitLabel: series.unitLabel, decimals: series.decimals,
    weekEnding: null, value: null, weekChange: null, stale, error,
  };
}

function rowFrom(series: WeeklyDef, observation: DoeWeeklyObservation, stale: boolean, error: string | null): DoeWeeklyRow {
  return {
    id: series.id, label: series.label, unitLabel: series.unitLabel, decimals: series.decimals,
    weekEnding: observation.weekEnding, value: observation.value, weekChange: observation.weekChange, stale, error,
  };
}

async function fetchObservation(series: WeeklyDef, transport: ThrottledFetchTransport): Promise<DoeWeeklyObservation> {
  const response = await transport(doeWeeklyDataUrl(series), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${series.label} is unavailable (${response.status})`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${series.label} is unavailable`);
  }
  try {
    return parseDoeWeeklyPayload(payload);
  } catch {
    throw new Error(`${series.label} is unavailable`);
  }
}

export function isDoeWeeklySeries(id: string | undefined): id is DoeWeeklySeriesId {
  return DOE_WEEKLY_SERIES.some((series) => series.id === id);
}

function snapshot(rows: DoeWeeklyRow[]): DoeWeeklySnapshot {
  return {
    rows,
    errors: rows.flatMap((row) => row.error ? [row.error] : []),
    stale: rows.some((row) => row.stale),
  };
}

export function getCachedDoeWeekly(): DoeWeeklySnapshot | null {
  const rows = DOE_WEEKLY_SERIES.map((series) => {
    const cached = cachedCloudResource(doeWeeklyCache, series.id, validateObservation);
    return cached ? rowFrom(series, cached.payload, false, null) : null;
  });
  if (rows.every((row) => row == null)) return null;
  return snapshot(rows.map((row, index) => row ?? emptyRow(DOE_WEEKLY_SERIES[index]!, null)));
}

/** Each series fails on its own. A miss does not drop the others or the cloud board. */
export async function loadDoeWeeklySeries(
  force = false,
  transport: ThrottledFetchTransport = (url, init) => weeklyFetch.fetch(url, init),
): Promise<DoeWeeklySnapshot> {
  const rows = await Promise.all(DOE_WEEKLY_SERIES.map(async (series) => {
    try {
      const resource = await loadCloudResource(
        doeWeeklyCache,
        series.id,
        () => fetchObservation(series, transport),
        { force, validate: validateObservation },
      );
      const error = resource.refreshError ? unavailable(series, new Error(resource.refreshError)) : null;
      return rowFrom(series, resource.payload, resource.stale, error);
    } catch (error) {
      return emptyRow(series, unavailable(series, error));
    }
  }));
  return snapshot(rows);
}
