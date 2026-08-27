export const OPENSKY_PLUGIN_ID = "opensky";
export const OPENSKY_CONNECTION_ID = "opensky";
export const OPENSKY_API_BASE_URL = "https://opensky-network.org/api";

export interface AircraftState {
  icao24: string;
  callsign: string;
  originCountry: string;
  longitude: number | null;
  latitude: number | null;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  onGround: boolean;
  lastContact: number | null;
}

export interface AircraftPage {
  aircraft: AircraftState[];
  time: number | null;
  hasNext: false;
}
