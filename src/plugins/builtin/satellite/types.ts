export const SATELLITE_PANE_ID = "satellite";
export const SATELLITE_PLUGIN_ID = "satellite";
export const FIRMS_CONNECTION_ID = "nasa-firms";
export const GIBS_CONNECTION_ID = "nasa-gibs";

export interface FireHotspot {
  id: string;
  lat: number;
  lon: number;
  brightness: number | null;
  frp: number | null;
  satellite: string;
  confidence: string;
  acqDate: string;
  acqTime: string;
  daynight: string;
  url: string;
}

export interface ImageryLayer {
  id: string;
  label: string;
  layer: string;
}

export type SatelliteTab = "fires" | "imagery";
export type LoadStatus = "idle" | "loading" | "loaded" | "error";
