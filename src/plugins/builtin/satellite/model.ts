import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortPreference } from "../../../utils/sort-values";
import type { FireHotspot } from "./types";

export type FireColumnId = "time" | "lat" | "lon" | "frp" | "bright" | "sat";
export type FireColumn = DataTableColumn & { id: FireColumnId };
export type FireSort = SortPreference<FireColumnId>;

export const DEFAULT_FIRE_SORT: FireSort = { columnId: "frp", direction: "desc" };
export const FIRE_ROW_CAP = 500;

export function buildFireColumns(): FireColumn[] {
  return [
    { id: "time", label: "ACQ", width: 14, align: "left", flexGrow: 1 },
    { id: "lat", label: "LAT", width: 8, align: "right" },
    { id: "lon", label: "LON", width: 8, align: "right" },
    { id: "frp", label: "FRP", width: 8, align: "right" },
    { id: "bright", label: "BRT", width: 8, align: "right" },
    { id: "sat", label: "SAT", width: 6, align: "left" },
  ];
}

function sortValue(columnId: FireColumnId, row: FireHotspot): string | number | null {
  switch (columnId) {
    case "time":
      return `${row.acqDate}${row.acqTime}`;
    case "lat":
      return row.lat;
    case "lon":
      return row.lon;
    case "frp":
      return row.frp;
    case "bright":
      return row.brightness;
    case "sat":
      return row.satellite;
  }
}

export function sortFireRows(rows: FireHotspot[], sort: FireSort): FireHotspot[] {
  const columnId = sort.columnId ?? "frp";
  return [...rows].sort((left, right) => {
    const compared = compareSortValues(
      sortValue(columnId, left),
      sortValue(columnId, right),
      sort.direction,
    );
    return compared !== 0 ? compared : right.frp! - (left.frp ?? 0);
  });
}

export function nextFireSort(current: FireSort, columnId: FireColumnId): FireSort {
  if (current.columnId !== columnId) {
    return { columnId, direction: columnId === "sat" || columnId === "time" ? "asc" : "desc" };
  }
  if (current.direction === "desc") return { columnId, direction: "asc" };
  return DEFAULT_FIRE_SORT;
}
