import type { DataTableColumn } from "../../../components";
import { getTableWidth } from "../../../components/ui/table-layout";
import { formatCompact, formatNumber, formatPercentRaw } from "../../../utils/format";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";

export const CANADA_LISTINGS_PANE_ID = "canada-listings";

export interface CanadaListing {
  symbol: string;
  name: string;
  last: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
}

export type CanadaListingColumnId = "symbol" | "name" | "last" | "change" | "changePercent" | "volume";
export type CanadaListingColumn = DataTableColumn & { id: CanadaListingColumnId };

export interface CanadaListingSort {
  columnId: CanadaListingColumnId;
  direction: SortDirection;
}

/** The board arrives ranked by session volume. */
export const DEFAULT_LISTING_SORT: CanadaListingSort = { columnId: "volume", direction: "desc" };

const TEXT_COLUMNS = new Set<CanadaListingColumnId>(["symbol", "name"]);

export function firstListingSortDirection(columnId: CanadaListingColumnId): SortDirection {
  return TEXT_COLUMNS.has(columnId) ? "asc" : "desc";
}

/** `RCI` keeps `RCI.B`. A symbol with no class does not match every ticker that contains it. */
export function normalizeListingSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/:CA$/, "").replace(/\.TO$/, "");
}

export function listingMatchesSymbol(symbol: string, query: string): boolean {
  const needle = normalizeListingSymbol(query);
  if (!needle) return true;
  const ticker = symbol.toUpperCase();
  return ticker === needle || ticker.startsWith(`${needle}.`);
}

export function filterCanadaListings(listings: readonly CanadaListing[], query: string): CanadaListing[] {
  const needle = normalizeListingSymbol(query);
  if (!needle) return [...listings];
  return listings.filter((row) => listingMatchesSymbol(row.symbol, needle));
}

const SORT_VALUE: Record<CanadaListingColumnId, (row: CanadaListing) => string | number | null> = {
  symbol: (row) => row.symbol,
  name: (row) => row.name,
  last: (row) => row.last,
  change: (row) => row.change,
  changePercent: (row) => row.changePercent,
  volume: (row) => row.volume,
};

export function sortCanadaListings(listings: readonly CanadaListing[], sort: CanadaListingSort): CanadaListing[] {
  return listings
    .map((row, index) => ({ row, index }))
    .sort((left, right) => compareSortValues(
      SORT_VALUE[sort.columnId](left.row),
      SORT_VALUE[sort.columnId](right.row),
      sort.direction,
    ) || left.index - right.index)
    .map(({ row }) => row);
}

function listingDecimals(value: number): number {
  return Math.abs(value) > 0 && Math.abs(value) < 1 ? 3 : 2;
}

export function formatListingPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatNumber(value, listingDecimals(value));
}

/** Signed price change. A value that rounds to zero is unsigned, and the digits follow the last price. */
export function formatListingChange(value: number | null, reference: number | null = value): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const decimals = listingDecimals(reference != null && reference !== 0 ? reference : value);
  const fixed = Math.abs(value).toFixed(decimals);
  if (!/[1-9]/.test(fixed)) return fixed;
  return `${value > 0 ? "+" : "-"}${fixed}`;
}

export function formatListingPercent(value: number | null): string {
  return value == null ? "—" : formatPercentRaw(value);
}

export function formatListingVolume(value: number | null): string {
  return value == null ? "—" : formatCompact(value, { fixedDecimals: true });
}

export function buildListingColumns(width: number): CanadaListingColumn[] {
  const columns: CanadaListingColumn[] = [
    { id: "symbol", label: "Symbol", width: 8, align: "left" },
    { id: "name", label: "Name", width: 16, align: "left", flexGrow: 1 },
    { id: "last", label: "Last", width: 9, align: "right" },
    { id: "change", label: "Change", width: 9, align: "right" },
    { id: "changePercent", label: "Chg %", width: 8, align: "right" },
    { id: "volume", label: "Volume", width: 9, align: "right" },
  ];
  const drop = (id: CanadaListingColumnId) => {
    const index = columns.findIndex((column) => column.id === id);
    if (index >= 0) columns.splice(index, 1);
  };
  const fits = () => getTableWidth(columns) <= width;
  if (!fits()) drop("name");
  if (!fits()) drop("changePercent");
  if (!fits()) drop("change");
  return columns;
}
