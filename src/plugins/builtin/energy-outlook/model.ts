import type { EiaRecord } from "./client";

export type EnergyTab = "outlook" | "imports" | "outages";

export const OUTLOOK_SERIES = [
  { id: "BREPUUS", name: "Brent" },
  { id: "WTIPUUS", name: "WTI" },
  { id: "COPRPUS", name: "US crude production" },
  { id: "MGTCPUSX", name: "Gasoline demand" },
  { id: "DFTCPUS", name: "Distillate demand" },
] as const;

const IMPORT_LIMIT = 15;

export interface OutlookRow {
  id: string;
  name: string;
  period: string;
  value: number | null;
  previous: number | null;
  unit: string;
}

export interface ImportRow {
  id: string;
  origin: string;
  volume: number;
  unit: string;
}

export interface OutageRow {
  id: string;
  facility: string;
  outage: number | null;
  capacity: number | null;
  percent: number | null;
  period: string;
}

export function readNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatEnergyValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const negative = value < 0;
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  const fixed = absolute.toFixed(digits);
  if (Number(fixed) === 0) return "0";
  const [whole, fraction] = fixed.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = fraction ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${text}` : text;
}

function newestPeriod(records: EiaRecord[]): string | null {
  return records.reduce<string | null>((newest, record) => (newest == null || record.period > newest ? record.period : newest), null);
}

/** One row per known series: the newest month and the month before it. */
export function outlookRows(records: EiaRecord[]): OutlookRow[] {
  const byId = new Map<string, EiaRecord[]>();
  for (const record of records) {
    const id = record.fields.seriesId;
    if (!id) continue;
    const points = byId.get(id);
    if (points) points.push(record);
    else byId.set(id, [record]);
  }
  const rows: OutlookRow[] = [];
  for (const series of OUTLOOK_SERIES) {
    const points = (byId.get(series.id) ?? []).slice().sort((a, b) => b.period.localeCompare(a.period));
    const latest = points[0];
    if (!latest) continue;
    const previous = points.find((point) => point.period < latest.period);
    rows.push({
      id: series.id,
      name: latest.fields.seriesDescription || series.name,
      period: latest.period,
      value: readNumber(latest.fields.value),
      previous: previous ? readNumber(previous.fields.value) : null,
      unit: latest.fields.unit ?? "",
    });
  }
  return rows;
}

/**
 * Latest month, countries only, summed across grades at port districts.
 * The same barrel is also reported by state and refinery, so those rows are left out.
 */
export function importRows(records: EiaRecord[]): ImportRow[] {
  const period = newestPeriod(records);
  if (!period) return [];
  const totals = new Map<string, { origin: string; volume: number; unit: string }>();
  for (const record of records) {
    if (record.period !== period) continue;
    if (record.fields.originType && record.fields.originType !== "CTY") continue;
    if (record.fields.destinationType && record.fields.destinationType !== "PP") continue;
    const id = record.fields.originId || record.fields.originName;
    const origin = record.fields.originName || id;
    const volume = readNumber(record.fields.quantity);
    if (!id || !origin || volume == null) continue;
    const current = totals.get(id);
    if (current) current.volume += volume;
    else totals.set(id, { origin, volume, unit: record.fields["quantity-units"] || "thousand barrels" });
  }
  return [...totals.entries()]
    .map(([id, row]) => ({ id, origin: row.origin, volume: row.volume, unit: row.unit }))
    .sort((a, b) => b.volume - a.volume || a.origin.localeCompare(b.origin))
    .slice(0, IMPORT_LIMIT);
}

/** Plants on the newest day, largest outage first. A country total is one row. */
export function outageRows(records: EiaRecord[]): OutageRow[] {
  const period = newestPeriod(records);
  if (!period) return [];
  const day = records.filter((record) => record.period === period);
  const plants = day.filter((record) => record.fields.facility || record.fields.facilityName);
  if (plants.length === 0) {
    const row = day[0];
    if (!row) return [];
    return [{
      id: "us",
      facility: "United States",
      outage: readNumber(row.fields.outage),
      capacity: readNumber(row.fields.capacity),
      percent: readNumber(row.fields.percentOutage),
      period,
    }];
  }
  const seen = new Set<string>();
  const rows: OutageRow[] = [];
  for (const record of plants) {
    const id = record.fields.facility || record.fields.facilityName!;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      facility: record.fields.facilityName || id,
      outage: readNumber(record.fields.outage),
      capacity: readNumber(record.fields.capacity),
      percent: readNumber(record.fields.percentOutage),
      period,
    });
  }
  rows.sort((a, b) => (b.outage ?? -1) - (a.outage ?? -1) || a.facility.localeCompare(b.facility));
  return rows;
}
