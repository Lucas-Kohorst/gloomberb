export const TRAFFIC_PANE_ID = "traffic";
export const TRAFFIC_PLUGIN_ID = "traffic";
export const OPENSKY_CONNECTION_ID = "opensky";
export const DIGITRAFFIC_CONNECTION_ID = "digitraffic-ais";

export type TrafficKind = "aircraft" | "ship";

export interface GeoBbox {
  id: string;
  label: string;
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

export interface TrafficVehicle {
  id: string;
  kind: TrafficKind;
  callsign: string;
  country: string;
  lat: number;
  lon: number;
  altitudeM: number | null;
  speedMs: number | null;
  heading: number | null;
  onGround: boolean;
  source: string;
  url: string;
  updatedAt: number;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
