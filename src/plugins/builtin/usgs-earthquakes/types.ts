export const USGS_EARTHQUAKES_PLUGIN_ID = "usgs-earthquakes";
export const USGS_EARTHQUAKES_CONNECTION_ID = "usgs-earthquakes";
export const USGS_API_BASE_URL = "https://earthquake.usgs.gov/fdsnws/event/1";

/** A single earthquake event from the USGS GeoJSON feed. */
export interface Earthquake {
  id: string;
  magnitude: number;
  place: string;
  time: Date;
  url: string;
  tsunami: boolean;
  significance: number;
  type: string;
  title: string;
  longitude: number;
  latitude: number;
  depth: number;
}

/** A page of earthquake results. */
export interface EarthquakePage {
  earthquakes: Earthquake[];
  total: number;
}
