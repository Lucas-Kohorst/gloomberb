import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortDirection, nextSortPreference as nextSharedSortPreference } from "../../../utils/sort-values";
import { colors } from "../../../theme/colors";
import type { IPORecord, IPOStatus } from "./types";

type IPOColumnId =
  | "ticker"
  | "date"
  | "status"
  | "exchange"
  | "offer"
  | "price"
  | "shares"
  | "return";

export type IPOColumn = DataTableColumn & { id: IPOColumnId };

export interface IPOSortPreference {
  columnId: IPOColumnId | null;
  direction: SortDirection;
}

export const DEFAULT_SORT_PREFERENCE: IPOSortPreference = {
  columnId: null,
  direction: "asc",
};

const STATUS_LABEL: Record<IPOStatus, string> = {
  upcoming: "upcoming",
  priced: "priced",
  trading: "trading",
  withdrawn: "withdrawn",
};

export function statusLabel(status: IPOStatus): string {
  return STATUS_LABEL[status];
}

export function statusColor(status: IPOStatus): string {
  switch (status) {
    case "upcoming":
      return colors.warning;
    case "priced":
      return colors.textBright;
    case "trading":
      return colors.positive;
    case "withdrawn":
      return colors.negative;
  }
}

export function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatOfferSize(value: number | null): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatShares(value: number | null): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

export function formatPrice(record: IPORecord): string {
  if (record.pricedPrice != null) return `$${record.pricedPrice.toFixed(2)}`;
  if (record.priceRange != null) return `$${record.priceRange[0].toFixed(2)}–$${record.priceRange[1].toFixed(2)}`;
  return "—";
}

export function formatReturn(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function buildColumns(_width: number): IPOColumn[] {
  return [
    { id: "ticker", label: "TICKER", width: 7, align: "left" },
    { id: "date", label: "DATE", width: 11, align: "left" },
    { id: "status", label: "STATUS", width: 9, align: "left" },
    { id: "exchange", label: "EXCH", width: 8, align: "left" },
    { id: "offer", label: "OFFER", width: 8, align: "right" },
    { id: "price", label: "PRICE", width: 12, align: "right" },
    { id: "shares", label: "SHARES", width: 7, align: "right" },
    { id: "return", label: "RETURN", width: 8, align: "right" },
  ];
}

function getSortValue(columnId: IPOColumnId, row: IPORecord): string | number | null {
  switch (columnId) {
    case "ticker":
      return row.ticker;
    case "date":
      return row.date.getTime();
    case "status":
      return row.status;
    case "exchange":
      return row.exchange ?? "";
    case "offer":
      return row.offerSize;
    case "price":
      return row.pricedPrice ?? row.priceRange?.[0] ?? null;
    case "shares":
      return row.shares;
    case "return":
      return row.change1D;
  }
}

export function sortRows(rows: IPORecord[], sort: IPOSortPreference): IPORecord[] {
  if (!sort.columnId) return rows;
  return [...rows].sort((a, b) =>
    compareSortValues(getSortValue(sort.columnId!, a), getSortValue(sort.columnId!, b), sort.direction),
  );
}

export function nextSortPreference(current: IPOSortPreference, columnId: string): IPOSortPreference {
  return nextSharedSortPreference(current, columnId as IPOColumnId, {
    defaultDirection: "asc",
    resetTo: DEFAULT_SORT_PREFERENCE,
  }) as IPOSortPreference;
}

export function matchesSearch(record: IPORecord, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    record.ticker.toLowerCase().includes(q) ||
    record.companyName.toLowerCase().includes(q) ||
    (record.exchange?.toLowerCase().includes(q) ?? false) ||
    record.status.includes(q)
  );
}
