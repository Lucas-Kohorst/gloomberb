import { httpFetch } from "../../../utils/http-transport";
import {
  nowcastRow,
  NOWCAST_SERIES,
  type NowcastObservation,
  type NowcastRow,
  type NowcastSeries,
} from "./model";

const FETCH_TIMEOUT_MS = 15_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function seriesUrl(id: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
}

function cell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function observationValue(raw: string): number | null {
  if (!raw || raw === ".") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseFredGraphCsv(csv: string): NowcastObservation[] {
  const text = csv.replace(/^\uFEFF/, "").trim();
  if (!text || /^<!doctype html/i.test(text) || /^<html/i.test(text)) return [];
  const observations: NowcastObservation[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const date = cell(line.slice(0, comma));
    if (!DATE_RE.test(date)) continue;
    const rest = line.slice(comma + 1);
    const next = rest.indexOf(",");
    observations.push({ date, value: observationValue(cell(next < 0 ? rest : rest.slice(0, next))) });
  }
  return observations;
}

export function nowcastFromCsv(series: NowcastSeries, csv: string): NowcastRow | null {
  return nowcastRow(series, parseFredGraphCsv(csv));
}

async function fetchSeriesCsv(id: string): Promise<string> {
  const response = await httpFetch(seriesUrl(id), {
    headers: {
      Accept: "text/csv, */*;q=0.8",
      // A browser-like agent stalls on this CSV. curl receives it.
      "User-Agent": "curl/8.7.1",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.text();
}

export async function fetchNowcasts(): Promise<NowcastRow[]> {
  const results = await Promise.all(NOWCAST_SERIES.map(async (series) => {
    try {
      return nowcastFromCsv(series, await fetchSeriesCsv(series.id));
    } catch {
      return null;
    }
  }));
  const rows = results.filter((row): row is NowcastRow => row != null);
  if (rows.length === 0) throw new Error("No observations returned.");
  return rows;
}
