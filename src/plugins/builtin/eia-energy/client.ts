import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { colors } from "../../../theme/colors";
import type { ResolvedSeries } from "../../../time-series/types";
import { withConnectionRequest } from "../connections/register";
import {
  EIA_API_BASE_URL,
  EIA_DEMO_KEY,
  EIA_ENERGY_CONNECTION_ID,
  findEiaSeries,
  type EiaSeriesDef,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

const eiaFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-eia-energy",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

/** One weekly observation, newest first. */
export interface EiaDataPoint {
  period: string;
  date: Date;
  value: number;
}

export interface EiaSeriesSummary {
  def: EiaSeriesDef;
  points: EiaDataPoint[];
  latest: EiaDataPoint | null;
  previous: EiaDataPoint | null;
  change: number | null;
  changePct: number | null;
}

export function buildSeriesDataUrl(def: EiaSeriesDef, apiKey: string, length: number): string {
  const params = new URLSearchParams();
  params.set("api_key", apiKey);
  params.set("frequency", def.frequency);
  params.set("data[0]", "value");
  params.append("facets[series][]", def.facetSeries);
  params.set("sort[0][column]", "period");
  params.set("sort[0][direction]", "desc");
  params.set("offset", "0");
  params.set("length", String(length));
  return `${EIA_API_BASE_URL}/${def.route}/data/?${params.toString()}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asPeriodDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}(-\d{2})?$/.test(value.trim())) return null;
  const date = new Date(`${value.trim()}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePoint(row: unknown): EiaDataPoint | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const date = asPeriodDate(record.period);
  const value = asNumber(record.value);
  if (!date || value == null) return null;
  return { period: String(record.period).trim(), date, value };
}

/**
 * Parse an EIA v2 /data envelope. Values arrive as strings (v2.1.6+); rows
 * with missing/non-numeric values are skipped, never fatal.
 */
export function parseEiaDataPayload(data: unknown, def: EiaSeriesDef, cap = 500): EiaSeriesSummary {
  const empty: EiaSeriesSummary = { def, points: [], latest: null, previous: null, change: null, changePct: null };
  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const response = (record.response && typeof record.response === "object"
    ? record.response
    : {}) as Record<string, unknown>;
  const rows = Array.isArray(response.data) ? response.data : [];
  const points: EiaDataPoint[] = [];
  for (const row of rows) {
    const point = parsePoint(row);
    if (!point) continue;
    points.push(point);
    if (points.length >= cap) break;
  }
  points.sort((a, b) => b.date.getTime() - a.date.getTime());
  return summarizePoints(def, points);
}

export function summarizePoints(def: EiaSeriesDef, points: EiaDataPoint[]): EiaSeriesSummary {
  const latest = points[0] ?? null;
  const previous = points[1] ?? null;
  let change: number | null = null;
  let changePct: number | null = null;
  if (latest && previous) {
    change = latest.value - previous.value;
    changePct = previous.value !== 0 ? (change / Math.abs(previous.value)) * 100 : null;
  }
  return { def, points, latest, previous, change, changePct };
}

export function formatEiaValue(def: EiaSeriesDef, value: number): string {
  if (def.kind === "price") return `$${value.toFixed(def.decimals)}`;
  const rounded = def.decimals > 0 ? value.toFixed(def.decimals) : Math.round(value).toLocaleString("en-US");
  return `${rounded} ${def.unit}`;
}

export function formatChangePct(changePct: number | null): string {
  if (changePct == null || !Number.isFinite(changePct)) return "—";
  const sign = changePct > 0 ? "+" : "";
  return `${sign}${changePct.toFixed(1)}% w/w`;
}

export class EiaEnergyClient {
  constructor(private readonly apiKey: string = EIA_DEMO_KEY) {}

  async listSeriesPoints(seriesId: string, length = 52, signal?: AbortSignal): Promise<EiaSeriesSummary> {
    const def = findEiaSeries(seriesId);
    if (!def) throw new Error(`Unknown EIA series "${seriesId}"`);
    return withConnectionRequest(EIA_ENERGY_CONNECTION_ID, "fetch", async () => {
      const url = buildSeriesDataUrl(def, this.apiKey, length);
      const init: RequestInit = {};
      if (signal) init.signal = signal;
      const response = await eiaFetch.fetch(url, Object.keys(init).length > 0 ? init : undefined);
      if (!response.ok) {
        throw new Error(`EIA request failed: ${response.status} ${response.statusText}`);
      }
      return parseEiaDataPayload(await response.json(), def, length);
    });
  }
}

/** Resolve a catalog series id into chartable points (uses the public demo key). */
export async function resolveEiaChartSeries(seriesId: string, signal?: AbortSignal): Promise<ResolvedSeries> {
  const def = findEiaSeries(seriesId);
  if (!def) throw new Error(`Unknown EIA series "${seriesId}". Use one of: crude-stocks, gasoline-stocks, distillate-stocks, gas-storage, gasoline-price, diesel-price, crude-production.`);
  const client = new EiaEnergyClient(EIA_DEMO_KEY);
  const summary = await client.listSeriesPoints(def.id, 260, signal);
  if (summary.points.length === 0) throw new Error(`EIA returned no points for ${def.label}`);
  const ascending = [...summary.points].sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    id: `eia-energy:${def.id}`,
    label: def.label,
    color: colors.textBright,
    unit: def.unit,
    unitGroup: `eia:${def.kind}`,
    nativeFrequency: "weekly",
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    points: ascending.map((point) => ({
      date: point.date,
      observedAt: point.date,
      value: point.value,
    })),
  };
}
