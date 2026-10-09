import { httpFetch } from "../../../utils/http-transport";
import {
  boardAsOf,
  selectSeries,
  toDealerRow,
  type CatalogEntry,
  type DealerRow,
  type DealerTab,
} from "./model";

const LIST_URL = "https://markets.newyorkfed.org/api/pd/list/timeseries.json";
const FETCH_TIMEOUT_MS = 15_000;

export interface SeriesPoint {
  asOf: string;
  value: number;
}

export interface ParsedSeries {
  keyid: string;
  unit: string | null;
  latest: SeriesPoint | null;
  previous: SeriesPoint | null;
}

export interface DealerBoard {
  seriesBreak: string;
  positions: DealerRow[];
  fails: DealerRow[];
  asOf: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function readUnit(...sources: Array<Record<string, unknown> | null>): string | null {
  for (const source of sources) {
    if (!source) continue;
    const unit = asText(source.unit) ?? asText(source.units) ?? asText(source.unit_name);
    if (unit) return unit;
  }
  return null;
}

export function parseCatalog(payload: unknown): CatalogEntry[] {
  const root = asRecord(payload);
  const pd = asRecord(root?.pd);
  const rows = Array.isArray(pd?.timeseries) ? pd.timeseries : Array.isArray(root?.timeseries) ? root.timeseries : [];
  const entries: CatalogEntry[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const seriesBreak = asText(row.seriesbreak) ?? asText(row.seriesBreak);
    const keyid = asText(row.keyid) ?? asText(row.keyId);
    if (!seriesBreak || !keyid) continue;
    entries.push({ seriesBreak, keyid, description: asText(row.description) ?? "" });
  }
  return entries;
}

/** Latest two observations. Points may arrive oldest-last or newest-last. */
export function parseSeriesObservations(payload: unknown, fallbackKeyid = ""): ParsedSeries {
  const root = asRecord(payload);
  const pd = asRecord(root?.pd);
  const rows = Array.isArray(pd?.timeseries) ? pd.timeseries : Array.isArray(root?.timeseries) ? root.timeseries : [];
  const points: Array<SeriesPoint & { unit: string | null; keyid: string }> = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const asOf = asDate(row.asofdate) ?? asDate(row.asOfDate) ?? asDate(row.date);
    const value = asNumber(row.value);
    if (!asOf || value == null) continue;
    points.push({
      asOf,
      value,
      keyid: asText(row.keyid) ?? fallbackKeyid,
      unit: readUnit(row, pd, root),
    });
  }
  points.sort((a, b) => a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0);
  const latest = points.length > 0 ? points[points.length - 1] ?? null : null;
  const previous = points.length >= 2 ? points[points.length - 2] ?? null : null;
  return {
    keyid: latest?.keyid || fallbackKeyid,
    unit: latest?.unit ?? previous?.unit ?? null,
    latest: latest ? { asOf: latest.asOf, value: latest.value } : null,
    previous: previous ? { asOf: previous.asOf, value: previous.value } : null,
  };
}

function seriesUrl(seriesBreak: string, keyid: string): string {
  return `https://markets.newyorkfed.org/api/pd/get/${encodeURIComponent(seriesBreak)}/timeseries/${encodeURIComponent(keyid)}.json`;
}

async function readJson(url: string): Promise<unknown> {
  const response = await httpFetch(url, {
    headers: { Accept: "application/json", "User-Agent": "gloomberb" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

export async function fetchPrimaryDealers(): Promise<DealerBoard> {
  const selected = selectSeries(parseCatalog(await readJson(LIST_URL)));
  const jobs: Array<{ entry: CatalogEntry; tab: DealerTab }> = [
    ...selected.positions.map((entry) => ({ entry, tab: "positions" as const })),
    ...selected.fails.map((entry) => ({ entry, tab: "fails" as const })),
  ];
  if (jobs.length === 0) throw new Error("No position series were listed.");
  const rows = (await Promise.all(jobs.map(async ({ entry, tab }) => {
    const parsed = parseSeriesObservations(await readJson(seriesUrl(entry.seriesBreak, entry.keyid)), entry.keyid);
    return toDealerRow(entry, parsed, tab);
  }))).filter((row) => row.latest != null);
  if (rows.length === 0) throw new Error("No positions were recognized.");
  return {
    seriesBreak: selected.seriesBreak,
    positions: rows.filter((row) => row.tab === "positions"),
    fails: rows.filter((row) => row.tab === "fails"),
    asOf: boardAsOf(rows),
  };
}
