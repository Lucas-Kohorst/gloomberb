import type { DataTableColumn } from "../../../components";
import { formatCompact, formatNumber } from "../../../utils/format";
import type { ShortInterestRecord } from "./types";
import { nextSortPreference as nextSharedSortPreference } from "../../../utils/sort-values";

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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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

export function sortRows(rows: ShortInterestRow[], preference: SortPreference): ShortInterestRow[] {
  const { columnId, direction } = preference;
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (columnId) {
      case "settlementDate":
        cmp = a.record.settlementDate.getTime() - b.record.settlementDate.getTime();
        break;
      case "sharesShort":
        cmp = a.record.sharesShort - b.record.sharesShort;
        break;
      case "shortRatio": {
        const av = a.record.shortRatio ?? -Infinity;
        const bv = b.record.shortRatio ?? -Infinity;
        cmp = av - bv;
        break;
      }
      case "averageDailyVolume": {
        const av = a.record.averageDailyVolume ?? -Infinity;
        const bv = b.record.averageDailyVolume ?? -Infinity;
        cmp = av - bv;
        break;
      }
      case "shortPercentFloat": {
        const av = a.record.shortPercentFloat ?? -Infinity;
        const bv = b.record.shortPercentFloat ?? -Infinity;
        cmp = av - bv;
        break;
      }
    }
    return direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export function nextSortPreference(
  current: SortPreference,
  columnId: string,
): SortPreference {
  return nextSharedSortPreference(current, columnId as ShortInterestColumnId) as SortPreference;
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
