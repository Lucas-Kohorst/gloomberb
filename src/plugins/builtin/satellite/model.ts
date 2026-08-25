import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortPreference } from "../../../utils/sort-values";
import type { FireHotspot } from "./types";

export type FireColumnId = "time" | "lat" | "lon" | "frp" | "bright" | "sat";
export type FireColumn = DataTableColumn & { id: FireColumnId };
export type FireSort = SortPreference<FireColumnId>;

export const DEFAULT_FIRE_SORT: FireSort = { columnId: "frp", direction: "desc" };
export const FIRE_ROW_CAP = 500;

export function buildFireColumns(width: number): FireColumn[] {
  const timeWidth = 14;
  const numWidth = 8;
  const satWidth = 6;
  const leftover = Math.max(8, width - 2 - 6 - timeWidth - numWidth * 4 - satWidth);
  return [
    { id: "time", label: "ACQ", width: timeWidth + Math.floor(leftover / 2), align: "left" },
    { id: "lat", label: "LAT", width: numWidth, align: "right" },
    { id: "lon", label: "LON", width: numWidth, align: "right" },
    { id: "frp", label: "FRP", width: numWidth, align: "right" },
    { id: "bright", label: "BRT", width: numWidth, align: "right" },
    { id: "sat", label: "SAT", width: satWidth, align: "left" },
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
