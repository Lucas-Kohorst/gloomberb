/**
 * Table model for the fundamental screener: columns, rows, and sorting.
 */

import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
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

export function buildScreenerColumns(width: number): ScreenerColumn[] {
  const symbolWidth = 7;
  const sectorWidth = 10;
  const priceWidth = 10;
  const mcapWidth = 9;
  const peWidth = 7;
  const pbWidth = 7;
  const deWidth = 7;
  const growthWidth = 7;
  const grossMarginWidth = 7;
  const netMarginWidth = 7;
  const divWidth = 7;
  const exchangeWidth = 8;

  const fixedWidth =
    symbolWidth + sectorWidth + priceWidth + mcapWidth + peWidth
    + pbWidth + deWidth + growthWidth + grossMarginWidth + netMarginWidth
    + divWidth + exchangeWidth;
  const nameWidth = Math.max(8, width - 2 - 12 - fixedWidth);

  return [
    { id: "symbol", label: "TICKER", width: symbolWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "sector", label: "SECTOR", width: sectorWidth, align: "left" },
    { id: "exchange", label: "EXCH", width: exchangeWidth, align: "left" },
    { id: "price", label: "PRICE", width: priceWidth, align: "right" },
    { id: "marketCap", label: "MCAP", width: mcapWidth, align: "right" },
    { id: "peRatio", label: "P/E", width: peWidth, align: "right" },
    { id: "pbRatio", label: "P/B", width: pbWidth, align: "right" },
    { id: "debtToEquity", label: "D/E", width: deWidth, align: "right" },
    { id: "revenueGrowth", label: "REV GR", width: growthWidth, align: "right" },
    { id: "grossMargin", label: "GR MGN", width: grossMarginWidth, align: "right" },
    { id: "netMargin", label: "NET MGN", width: netMarginWidth, align: "right" },
    { id: "dividendYield", label: "DIV YLD", width: divWidth, align: "right" },
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
  const typedColumnId = columnId as ScreenerColumnId;
  if (current.columnId !== typedColumnId) {
    return { columnId: typedColumnId, direction: "desc" };
  }
  if (current.direction === "desc") {
    return { columnId: typedColumnId, direction: "asc" };
  }
  return DEFAULT_SORT_PREFERENCE;
}
