import type { DataTableColumn } from "../../../components";
import { formatCompact, formatNumber } from "../../../utils/format";
import { compareSortValues } from "../../../utils/sort-values";
import type { ShortInterestRecord } from "./types";

export type ShortInterestColumnId =
  | "settlementDate"
  | "sharesShort"
  | "shortRatio"
  | "averageDailyVolume"
  | "shortPercentFloat";

export type ShortInterestColumn = DataTableColumn & { id: ShortInterestColumnId };

export interface ShortInterestRow {
  key: string;
  record: ShortInterestRecord;
  settlementDate: string;
  sharesShort: string;
  shortRatio: string;
  averageDailyVolume: string;
  shortPercentFloat: string;
}

export interface SortPreference {
  columnId: ShortInterestColumnId;
  direction: "asc" | "desc";
}

export const DEFAULT_SORT: SortPreference = {
  columnId: "settlementDate",
  direction: "desc",
};

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMaybeCompact(value: number | null): string {
  return value == null ? "-" : formatCompact(value);
}

function formatRatio(value: number | null): string {
  return value == null ? "-" : formatNumber(value, 2);
}

function formatPercent(value: number | null): string {
  return value == null ? "-" : `${formatNumber(value, 2)}%`;
}

export function buildRows(records: ShortInterestRecord[]): ShortInterestRow[] {
  return records.map((record, index) => ({
    key: `${record.settlementDate.toISOString()}:${index}`,
    record,
    settlementDate: formatDate(record.settlementDate),
    sharesShort: formatMaybeCompact(record.sharesShort),
    shortRatio: formatRatio(record.shortRatio),
    averageDailyVolume: formatMaybeCompact(record.averageDailyVolume),
    shortPercentFloat: formatPercent(record.shortPercentFloat),
  }));
}

function sortValue(row: ShortInterestRow, columnId: ShortInterestColumnId): string | number | null {
  switch (columnId) {
    case "settlementDate":
      return row.record.settlementDate.getTime();
    case "sharesShort":
      return row.record.sharesShort;
    case "shortRatio":
      return row.record.shortRatio;
    case "averageDailyVolume":
      return row.record.averageDailyVolume;
    case "shortPercentFloat":
      return row.record.shortPercentFloat;
  }
}

export function sortRows(rows: ShortInterestRow[], preference: SortPreference): ShortInterestRow[] {
  return [...rows].sort((a, b) =>
    compareSortValues(sortValue(a, preference.columnId), sortValue(b, preference.columnId), preference.direction),
  );
}

export function nextSortPreference(
  current: SortPreference,
  columnId: string,
): SortPreference {
  if (current.columnId === columnId) {
    return {
      columnId: columnId as ShortInterestColumnId,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return { columnId: columnId as ShortInterestColumnId, direction: "desc" };
}

export function buildColumns(width: number): ShortInterestColumn[] {
  const dateWidth = 12;
  const sharesWidth = 12;
  const ratioWidth = 12;
  const advWidth = Math.max(12, width - 2 - dateWidth - sharesWidth - ratioWidth - 12);
  const percentWidth = 10;
  return [
    { id: "settlementDate", label: "DATE", width: dateWidth, align: "left" },
    { id: "sharesShort", label: "SHARES SHORT", width: sharesWidth, align: "right" },
    { id: "shortRatio", label: "DAYS TO COVER", width: ratioWidth, align: "right" },
    { id: "averageDailyVolume", label: "AVG DAILY VOL", width: advWidth, align: "right" },
    { id: "shortPercentFloat", label: "% FLOAT", width: percentWidth, align: "right" },
  ];
}
