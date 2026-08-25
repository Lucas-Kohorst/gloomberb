import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortPreference } from "../../../utils/sort-values";
import { inBbox, findBbox } from "./bbox";
import type { TrafficKind, TrafficVehicle } from "./types";

export type TrafficColumnId = "callsign" | "country" | "lat" | "lon" | "alt" | "speed";
export type TrafficColumn = DataTableColumn & { id: TrafficColumnId };
export type TrafficSort = SortPreference<TrafficColumnId>;

export const DEFAULT_TRAFFIC_SORT: TrafficSort = { columnId: "callsign", direction: "asc" };
export const TRAFFIC_ROW_CAP = 400;

export function buildTrafficColumns(width: number, kind: TrafficKind): TrafficColumn[] {
  const callsignWidth = Math.max(10, Math.min(16, Math.floor(width * 0.22)));
  const countryWidth = Math.max(8, Math.min(16, Math.floor(width * 0.22)));
  const numWidth = 8;
  return [
    { id: "callsign", label: kind === "ship" ? "NAME" : "CALL", width: callsignWidth, align: "left" },
    { id: "country", label: "COUNTRY", width: countryWidth, align: "left" },
    { id: "lat", label: "LAT", width: numWidth, align: "right" },
    { id: "lon", label: "LON", width: numWidth, align: "right" },
    { id: "alt", label: kind === "ship" ? "HDG" : "ALT", width: numWidth, align: "right" },
    { id: "speed", label: "SPD", width: numWidth, align: "right" },
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
