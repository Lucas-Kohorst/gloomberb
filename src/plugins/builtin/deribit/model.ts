import type { DataTableColumn } from "../../../components";
import { formatCompact, formatNumber } from "../../../utils/format";
import { compareSortValues, type SortPreference } from "../../../utils/sort-values";
import type { BookSummary } from "./client";

export type DerivativeCurrency = "BTC" | "ETH";

const MONTHS: Readonly<Record<string, number>> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const EXPIRY = /^[A-Z0-9]+-(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(?:-|$)/;

export function resolveCurrency(input: unknown): DerivativeCurrency {
  const text = Array.isArray(input)
    ? input.filter((part): part is string => typeof part === "string").join(" ")
    : typeof input === "string" ? input : "";
  const value = text.trim().toUpperCase();
  if (!value) return "BTC";
  if (value === "BTC" || value === "ETH") return value;
  throw new Error("Use BTC or ETH");
}

/** Milliseconds at UTC midnight, or null for a perpetual. */
export function expiryMillis(instrument: string): number | null {
  const match = EXPIRY.exec(instrument.trim().toUpperCase());
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS[match[2]!]!;
  const year = 2000 + Number(match[3]);
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (day < 1 || day > days) return null;
  return Date.UTC(year, month, day);
}

function expiryLabel(instrument: string): string | null {
  const match = EXPIRY.exec(instrument.trim().toUpperCase());
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

export interface FutureRow {
  id: string;
  instrument: string;
  expiry: number | null;
  last: number | null;
  mark: number | null;
  openInterest: number | null;
  volume: number | null;
  change: number | null;
}

export interface OptionExpiryRow {
  id: string;
  expiry: string;
  expiryMs: number;
  openInterest: number;
  volume: number;
  markIv: number | null;
}

export type FutureSortColumn = "instrument" | "last" | "mark" | "openInterest" | "volume" | "change";
export type OptionSortColumn = "expiry" | "openInterest" | "volume" | "markIv";

/** Null column keeps expiry order: perpetuals, then the nearest dated contract. */
export const FUTURE_EXPIRY_SORT: SortPreference<FutureSortColumn> = { columnId: null, direction: "asc" };
export const OPTION_EXPIRY_SORT: SortPreference<OptionSortColumn> = { columnId: "expiry", direction: "asc" };

export const FUTURE_COLUMNS: DataTableColumn[] = [
  { id: "instrument", label: "Instrument", width: 16, align: "left", flexGrow: 1 },
  { id: "last", label: "Last", width: 12, align: "right" },
  { id: "mark", label: "Mark", width: 12, align: "right" },
  { id: "openInterest", label: "Open interest", width: 12, align: "right" },
  { id: "volume", label: "Volume", width: 10, align: "right" },
  { id: "change", label: "24h", width: 8, align: "right" },
];

export const OPTION_COLUMNS: DataTableColumn[] = [
  { id: "expiry", label: "Expiry", width: 12, align: "left", flexGrow: 1 },
  { id: "openInterest", label: "Open interest", width: 14, align: "right" },
  { id: "volume", label: "Volume", width: 12, align: "right" },
  { id: "markIv", label: "Mark IV", width: 10, align: "right" },
];

export function futureRows(rows: readonly BookSummary[]): FutureRow[] {
  return rows
    .map((row) => ({
      id: row.instrument,
      instrument: row.instrument,
      expiry: expiryMillis(row.instrument),
      last: row.last,
      mark: row.mark,
      openInterest: row.openInterest,
      volume: row.volume,
      change: row.change,
    }))
    .sort((a, b) => (a.expiry ?? Number.NEGATIVE_INFINITY) - (b.expiry ?? Number.NEGATIVE_INFINITY)
      || a.instrument.localeCompare(b.instrument));
}

/**
 * One row per expiration. Open interest and volume sum every strike.
 * `mark_iv` is already a percent; strikes without it stay out of the average.
 */
export function optionExpiryRows(rows: readonly BookSummary[]): OptionExpiryRow[] {
  const groups = new Map<string, { expiryMs: number; openInterest: number; volume: number; ivSum: number; ivCount: number }>();
  for (const row of rows) {
    const label = expiryLabel(row.instrument);
    const expiryMs = expiryMillis(row.instrument);
    if (!label || expiryMs == null) continue;
    const group = groups.get(label) ?? { expiryMs, openInterest: 0, volume: 0, ivSum: 0, ivCount: 0 };
    group.openInterest += row.openInterest ?? 0;
    group.volume += row.volume ?? 0;
    if (row.markIv != null) {
      group.ivSum += row.markIv;
      group.ivCount += 1;
    }
    groups.set(label, group);
  }
  return [...groups.entries()]
    .map(([expiry, group]) => ({
      id: expiry,
      expiry,
      expiryMs: group.expiryMs,
      openInterest: group.openInterest,
      volume: group.volume,
      markIv: group.ivCount > 0 ? group.ivSum / group.ivCount : null,
    }))
    .sort((a, b) => a.expiryMs - b.expiryMs || a.expiry.localeCompare(b.expiry));
}

function futureValue(column: FutureSortColumn, row: FutureRow): string | number | null {
  switch (column) {
    case "instrument":
      return row.instrument;
    case "last":
      return row.last;
    case "mark":
      return row.mark;
    case "openInterest":
      return row.openInterest;
    case "volume":
      return row.volume;
    case "change":
      return row.change;
  }
}

function optionValue(column: OptionSortColumn, row: OptionExpiryRow): string | number | null {
  switch (column) {
    case "expiry":
      return row.expiryMs;
    case "openInterest":
      return row.openInterest;
    case "volume":
      return row.volume;
    case "markIv":
      return row.markIv;
  }
}

export function sortFutures(rows: readonly FutureRow[], sort: SortPreference<FutureSortColumn>): FutureRow[] {
  const column = sort.columnId;
  if (!column) return [...rows];
  return [...rows].sort((a, b) => {
    const compared = compareSortValues(futureValue(column, a), futureValue(column, b), sort.direction);
    return compared !== 0 ? compared : a.instrument.localeCompare(b.instrument);
  });
}

export function sortOptions(rows: readonly OptionExpiryRow[], sort: SortPreference<OptionSortColumn>): OptionExpiryRow[] {
  const column = sort.columnId ?? "expiry";
  const direction = sort.columnId ? sort.direction : "asc";
  return [...rows].sort((a, b) => {
    const compared = compareSortValues(optionValue(column, a), optionValue(column, b), direction);
    return compared !== 0 ? compared : a.expiryMs - b.expiryMs;
  });
}

export function formatPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const decimals = Math.abs(value) >= 1 ? 2 : 4;
  const rounded = Number(value.toFixed(decimals));
  return formatNumber(rounded === 0 ? 0 : rounded, decimals);
}

export function formatSize(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCompact(value, { fixedDecimals: true });
}

export function formatChange(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(2));
  if (rounded === 0) return "0.00%";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

export function formatIv(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(2));
  return `${rounded === 0 ? "0.00" : rounded.toFixed(2)}%`;
}

export function formatIndexLevel(value: number): string {
  const rounded = Number(value.toFixed(2));
  return `index ${rounded === 0 ? "0.00" : rounded.toFixed(2)}`;
}
