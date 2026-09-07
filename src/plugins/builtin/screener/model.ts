/**
 * Table model for the fundamental screener: columns, rows, and sorting.
 */

import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortDirection, nextSortPreference as nextSharedSortPreference } from "../../../utils/sort-values";
import { fuzzyFilter } from "../../../utils/fuzzy-search";
import type { ScreenerResult } from "./types";

export type ScreenerColumnId =
  | "symbol"
  | "name"
  | "sector"
  | "exchange"
  | "price"
  | "marketCap"
  | "peRatio"
  | "pbRatio"
  | "debtToEquity"
  | "revenueGrowth"
  | "grossMargin"
  | "netMargin"
  | "dividendYield";

export type ScreenerColumn = DataTableColumn & { id: ScreenerColumnId };

export type ScreenerRow = ScreenerResult;

export interface ScreenerSortPreference {
  columnId: ScreenerColumnId | null;
  direction: SortDirection;
}

export const DEFAULT_SORT_PREFERENCE: ScreenerSortPreference = {
  columnId: "marketCap",
  direction: "desc",
};

export function filterScreenerRows(rows: ScreenerResult[], query: string): ScreenerResult[] {
  return fuzzyFilter(rows, query, (row) => `${row.symbol} ${row.name} ${row.sector ?? ""}`);
}

export function buildScreenerColumns(): ScreenerColumn[] {
  return [
    { id: "symbol", label: "TICKER", width: 7, align: "left" },
    { id: "name", label: "NAME", width: 8, align: "left", flexGrow: 1 },
    { id: "sector", label: "SECTOR", width: 10, align: "left" },
    { id: "exchange", label: "EXCH", width: 8, align: "left" },
    { id: "price", label: "PRICE", width: 10, align: "right" },
    { id: "marketCap", label: "MCAP", width: 9, align: "right" },
    { id: "peRatio", label: "P/E", width: 7, align: "right" },
    { id: "pbRatio", label: "P/B", width: 7, align: "right" },
    { id: "debtToEquity", label: "D/E", width: 7, align: "right" },
    { id: "revenueGrowth", label: "REV GR", width: 7, align: "right" },
    { id: "grossMargin", label: "GR MGN", width: 7, align: "right" },
    { id: "netMargin", label: "NET MGN", width: 7, align: "right" },
    { id: "dividendYield", label: "DIV YLD", width: 7, align: "right" },
  ];
}

function getSortValue(columnId: ScreenerColumnId, row: ScreenerRow): string | number | null {
  switch (columnId) {
    case "symbol": return row.symbol;
    case "name": return row.name;
    case "sector": return row.sector;
    case "exchange": return row.exchange;
    case "price": return row.price;
    case "marketCap": return row.marketCap;
    case "peRatio": return row.peRatio;
    case "pbRatio": return row.pbRatio;
    case "debtToEquity": return row.debtToEquity;
    case "revenueGrowth": return row.revenueGrowth;
    case "grossMargin": return row.grossMargin;
    case "netMargin": return row.netMargin;
    case "dividendYield": return row.dividendYield;
  }
}

export function sortRows(
  rows: ScreenerRow[],
  sortPreference: ScreenerSortPreference,
): ScreenerRow[] {
  if (!sortPreference.columnId) return rows;
  return [...rows].sort((left, right) => compareSortValues(
    getSortValue(sortPreference.columnId!, left),
    getSortValue(sortPreference.columnId!, right),
    sortPreference.direction,
  ));
}

export function nextSortPreference(
  current: ScreenerSortPreference,
  columnId: string,
): ScreenerSortPreference {
  return nextSharedSortPreference(current, columnId as ScreenerColumnId, {
    resetTo: DEFAULT_SORT_PREFERENCE,
  }) as ScreenerSortPreference;
}
