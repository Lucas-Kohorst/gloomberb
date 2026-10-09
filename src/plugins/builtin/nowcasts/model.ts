import type { DataTableColumn } from "../../../components";

export const NOWCASTS_PANE_ID = "nowcasts";

export interface NowcastSeries {
  id: string;
  measure: string;
  decimals: number;
}

export const NOWCAST_SERIES: readonly NowcastSeries[] = [
  { id: "STICKCPIM159SFRBATL", measure: "Sticky CPI", decimals: 2 },
  { id: "MEDCPIM158SFRBCLE", measure: "Median CPI", decimals: 2 },
  { id: "NFCI", measure: "Financial conditions", decimals: 3 },
  { id: "ANFCI", measure: "Adjusted financial conditions", decimals: 3 },
];

export interface NowcastObservation {
  date: string;
  value: number | null;
}

export interface NowcastRow {
  id: string;
  measure: string;
  asOf: string;
  latest: number;
  previous: number | null;
  change: number | null;
  decimals: number;
}

export function nowcastRow(series: NowcastSeries, observations: readonly NowcastObservation[]): NowcastRow | null {
  const points = observations
    .filter((row): row is NowcastObservation & { value: number } => row.value != null && Number.isFinite(row.value))
    .sort((left, right) => left.date.localeCompare(right.date));
  const latest = points.at(-1);
  if (!latest) return null;
  const previous = points.at(-2) ?? null;
  return {
    id: series.id,
    measure: series.measure,
    asOf: latest.date,
    latest: latest.value,
    previous: previous?.value ?? null,
    change: previous ? latest.value - previous.value : null,
    decimals: series.decimals,
  };
}

export function newestAsOf(rows: readonly NowcastRow[]): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    if (newest == null || row.asOf > newest) newest = row.asOf;
  }
  return newest;
}

export function formatNowcastValue(value: number | null, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const text = value.toFixed(decimals);
  return Number(text) === 0 ? (0).toFixed(decimals) : text;
}

export function formatNowcastChange(value: number | null, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const text = formatNowcastValue(value, decimals);
  if (text.startsWith("-") || Number(text) === 0) return text;
  return `+${text}`;
}

export type NowcastColumnId = "measure" | "asOf" | "latest" | "previous" | "change";

export type NowcastColumn = DataTableColumn & { id: NowcastColumnId };

export const NOWCAST_COLUMNS: NowcastColumn[] = [
  { id: "measure", label: "MEASURE", width: 16, flexGrow: 1, align: "left" },
  { id: "asOf", label: "AS OF", width: 10, align: "left" },
  { id: "latest", label: "LATEST", width: 8, align: "right" },
  { id: "previous", label: "PREVIOUS", width: 10, align: "right" },
  { id: "change", label: "CHANGE", width: 8, align: "right" },
];
