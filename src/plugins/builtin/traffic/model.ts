import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortPreference } from "../../../utils/sort-values";
import { inBbox, findBbox } from "./bbox";
import type { TrafficKind, TrafficVehicle } from "./types";

export type TrafficColumnId = "callsign" | "country" | "lat" | "lon" | "alt" | "speed";
export type TrafficColumn = DataTableColumn & { id: TrafficColumnId };
export type TrafficSort = SortPreference<TrafficColumnId>;

export const DEFAULT_TRAFFIC_SORT: TrafficSort = { columnId: "callsign", direction: "asc" };
export const TRAFFIC_ROW_CAP = 400;

export function buildTrafficColumns(kind: TrafficKind): TrafficColumn[] {
  return [
    { id: "callsign", label: kind === "ship" ? "NAME" : "CALL", width: 10, align: "left", flexGrow: 1 },
    { id: "country", label: "COUNTRY", width: 8, align: "left" },
    { id: "lat", label: "LAT", width: 8, align: "right" },
    { id: "lon", label: "LON", width: 8, align: "right" },
    { id: "alt", label: kind === "ship" ? "HDG" : "ALT", width: 8, align: "right" },
    { id: "speed", label: "SPD", width: 8, align: "right" },
  ];
}

function sortValue(columnId: TrafficColumnId, row: TrafficVehicle): string | number | null {
  switch (columnId) {
    case "callsign":
      return row.callsign;
    case "country":
      return row.country;
    case "lat":
      return row.lat;
    case "lon":
      return row.lon;
    case "alt":
      return row.kind === "ship" ? row.heading : row.altitudeM;
    case "speed":
      return row.speedMs;
  }
}

export function sortTrafficRows(rows: TrafficVehicle[], sort: TrafficSort): TrafficVehicle[] {
  const columnId = sort.columnId ?? "callsign";
  return [...rows].sort((left, right) => {
    const compared = compareSortValues(
      sortValue(columnId, left),
      sortValue(columnId, right),
      sort.direction,
    );
    return compared !== 0 ? compared : left.callsign.localeCompare(right.callsign);
  });
}

export function nextTrafficSort(current: TrafficSort, columnId: TrafficColumnId): TrafficSort {
  if (current.columnId !== columnId) {
    return { columnId, direction: columnId === "callsign" || columnId === "country" ? "asc" : "desc" };
  }
  if (current.direction === "asc") return { columnId, direction: "desc" };
  return DEFAULT_TRAFFIC_SORT;
}

export function filterTrafficRows(
  rows: TrafficVehicle[],
  bboxId: string,
  kind: TrafficKind,
): TrafficVehicle[] {
  const bbox = findBbox(bboxId);
  return rows.filter((row) => row.kind === kind && (kind === "ship" ? inBbox(row.lat, row.lon, bbox) : true));
}
