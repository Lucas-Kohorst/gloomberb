import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import type { DividendPayment } from "./types";

export type DividendColumnId = "exDate" | "amount" | "currency";
export type DividendColumn = DataTableColumn & { id: DividendColumnId };

export interface DividendRow {
  key: string;
  exDate: string;
  amount: number;
  currency: string;
}

export interface DividendSortPreference {
  columnId: DividendColumnId | null;
  direction: SortDirection;
}

export const DEFAULT_SORT_PREFERENCE: DividendSortPreference = {
  columnId: "exDate",
  direction: "desc",
};

export function buildDividendColumns(width: number): DividendColumn[] {
  const dateWidth = 14;
  const currencyWidth = 6;
  const amountWidth = 10;
  const leftover = Math.max(dateWidth, width - 2 - amountWidth - currencyWidth);
  return [
    { id: "exDate", label: "EX-DATE", width: leftover, align: "left" },
    { id: "amount", label: "AMOUNT", width: amountWidth, align: "right" },
    { id: "currency", label: "CCY", width: currencyWidth, align: "left" },
  ];
}

function getSortValue(columnId: DividendColumnId, row: DividendRow): string | number | null {
  switch (columnId) {
    case "exDate": return row.exDate;
    case "amount": return row.amount;
    case "currency": return row.currency;
  }
}

export function sortRows(
  rows: DividendRow[],
  sortPreference: DividendSortPreference,
): DividendRow[] {
  if (!sortPreference.columnId) return rows;
  return [...rows].sort((left, right) => compareSortValues(
    getSortValue(sortPreference.columnId!, left),
    getSortValue(sortPreference.columnId!, right),
    sortPreference.direction,
  ));
}

export function nextSortPreference(
  current: DividendSortPreference,
  columnId: string,
): DividendSortPreference {
  const typedColumnId = columnId as DividendColumnId;
  if (current.columnId !== typedColumnId) {
    return { columnId: typedColumnId, direction: "desc" };
  }
  if (current.direction === "desc") {
    return { columnId: typedColumnId, direction: "asc" };
  }
  return DEFAULT_SORT_PREFERENCE;
}

export function toDividendRows(payments: DividendPayment[]): DividendRow[] {
  return payments.map((p, i) => ({
    key: `${p.exDate.toISOString()}:${i}`,
    exDate: formatDate(p.exDate),
    amount: p.amount,
    currency: p.currency,
  }));
}

function formatDate(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}
