import type { DataTableColumn } from "../../../components";
import { fitChartTableColumns } from "../../../components/chart-table";
import { formatNumber } from "../../../utils/format";
import { compareSortValues, type SortPreference } from "../../../utils/sort-values";

export const FAILS_PANE_ID = "fails-to-deliver";

/** The table and the report keep this many largest balances, not the whole file. */
export const FAIL_LIMIT = 100;

export interface FailRow {
  id: string;
  symbol: string;
  description: string;
  quantity: number;
  price: number | null;
  /** Settlement day, YYYY-MM-DD. */
  date: string;
}

export interface FailsReport {
  rows: FailRow[];
  /** Newest settlement day in the rows that passed the symbol filter. */
  settlementDate: string | null;
}

export function failSymbol(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function failSymbolFilter(source: {
  params?: { symbol?: string };
  settings?: Record<string, unknown>;
} | null | undefined): string {
  const fromParams = source?.params?.symbol;
  const fromSettings = source?.settings?.symbol;
  return failSymbol(fromParams ?? fromSettings);
}

export function formatFailPrice(value: number | null): string {
  return value == null ? "—" : formatNumber(value, 2);
}

export type FailColumnId = "symbol" | "description" | "quantity" | "price" | "date";

export type FailColumn = DataTableColumn & { id: FailColumnId };

export type FailSort = SortPreference<FailColumnId>;

/** Largest balance first: the reason the pane exists. */
export const DEFAULT_FAIL_SORT: FailSort = { columnId: "quantity", direction: "desc" };

const FAIL_COLUMNS: readonly FailColumn[] = [
  { id: "symbol", label: "Symbol", width: 10, align: "left" },
  { id: "description", label: "Description", width: 16, align: "left", flexGrow: 1 },
  { id: "quantity", label: "Quantity", width: 14, align: "right" },
  { id: "price", label: "Price", width: 10, align: "right" },
  { id: "date", label: "Date", width: 10, align: "left" },
];

/** Date is in the footer when every row shares it; price gives way next. */
const NARROW_DROP: readonly FailColumnId[] = ["date", "price"];

export function buildFailColumns(width: number): FailColumn[] {
  return fitChartTableColumns(FAIL_COLUMNS, width, NARROW_DROP);
}

function failSortValue(columnId: FailColumnId, row: FailRow): string | number | null {
  switch (columnId) {
    case "symbol":
      return row.symbol;
    case "description":
      return row.description;
    case "quantity":
      return row.quantity;
    case "price":
      return row.price;
    case "date":
      return row.date;
  }
}

export function sortFails(rows: readonly FailRow[], sort: FailSort): FailRow[] {
  const columnId = sort.columnId;
  if (!columnId) return [...rows];
  return [...rows].sort((a, b) => {
    const compared = compareSortValues(
      failSortValue(columnId, a),
      failSortValue(columnId, b),
      sort.direction,
    );
    return compared !== 0 ? compared : b.quantity - a.quantity || a.symbol.localeCompare(b.symbol);
  });
}
