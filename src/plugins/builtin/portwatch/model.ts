import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortPreference } from "../../../utils/sort-values";

export const PORTWATCH_PANE_ID = "portwatch";
export const SHIPPING_ROW_CAP = 80;

export type ShippingTab = "ports" | "chokepoints";
export type ShippingColumnId = "name" | "country" | "volume";

export const SHIPPING_TABS: readonly { value: ShippingTab; label: string }[] = [
  { value: "ports", label: "Ports" },
  { value: "chokepoints", label: "Chokepoints" },
];

export interface ShippingRow {
  id: string;
  name: string;
  country: string;
  volume: number | null;
}

export interface ShippingLayer {
  rows: ShippingRow[];
  volumeHeader: string | null;
  asOf: string | null;
  error: string | null;
}

export interface ShippingBoard {
  ports: ShippingLayer;
  chokepoints: ShippingLayer;
}

export interface ShippingColumn extends DataTableColumn {
  id: ShippingColumnId;
}

export function shippingTab(value: string | null | undefined): ShippingTab {
  return value === "chokepoints" ? "chokepoints" : "ports";
}

export function shippingColumns(layer: ShippingLayer | null | undefined): ShippingColumn[] {
  const columns: ShippingColumn[] = [
    { id: "name", label: "Name", width: 28, align: "left", flexGrow: 1 },
    { id: "country", label: "Country", width: 18, align: "left" },
  ];
  if (layer?.volumeHeader) {
    columns.push({ id: "volume", label: layer.volumeHeader, width: 12, align: "right" });
  }
  return columns;
}

export function visibleShippingSort(
  sort: SortPreference<ShippingColumnId>,
  columns: readonly ShippingColumn[],
): SortPreference<ShippingColumnId> {
  if (sort.columnId && columns.some((column) => column.id === sort.columnId)) return sort;
  return columns.some((column) => column.id === "volume")
    ? { columnId: "volume", direction: "desc" }
    : { columnId: "name", direction: "asc" };
}

export function sortShippingRows(
  rows: readonly ShippingRow[],
  sort: SortPreference<ShippingColumnId>,
): ShippingRow[] {
  const columnId = sort.columnId ?? "name";
  return [...rows].sort((left, right) => {
    const compared = compareSortValues(sortValue(left, columnId), sortValue(right, columnId), sort.direction);
    return compared === 0 ? compareSortValues(left.name, right.name, "asc") : compared;
  });
}

function sortValue(row: ShippingRow, columnId: ShippingColumnId): string | number | null {
  if (columnId === "volume") return row.volume;
  if (columnId === "country") return row.country || null;
  return row.name;
}

export function formatVolume(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : value;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function emptyShippingLayer(error: string | null = null): ShippingLayer {
  return { rows: [], volumeHeader: null, asOf: null, error };
}
