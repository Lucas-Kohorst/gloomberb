import type { GeoBbox } from "./types";

export const TRAFFIC_BBOXES: GeoBbox[] = [
  { id: "world", label: "World", lamin: -90, lomin: -180, lamax: 90, lomax: 180 },
  { id: "nam", label: "N. America", lamin: 15, lomin: -130, lamax: 72, lomax: -50 },
  { id: "eur", label: "Europe", lamin: 34, lomin: -12, lamax: 72, lomax: 40 },
  { id: "mena", label: "MENA", lamin: 10, lomin: -20, lamax: 42, lomax: 65 },
  { id: "asia", label: "Asia", lamin: -10, lomin: 60, lamax: 55, lomax: 150 },
];

export const DEFAULT_BBOX_ID = "mena";

export function findBbox(id: string): GeoBbox {
  return TRAFFIC_BBOXES.find((entry) => entry.id === id) ?? TRAFFIC_BBOXES[0]!;
}

export function inBbox(lat: number, lon: number, bbox: GeoBbox): boolean {
  return lat >= bbox.lamin && lat <= bbox.lamax && lon >= bbox.lomin && lon <= bbox.lomax;
}
