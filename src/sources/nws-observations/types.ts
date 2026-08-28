export const NWS_OBSERVATIONS_PROVIDER_ID = "nws-observations";
export const NWS_OBSERVATIONS_CONNECTION_ID = "nws-observations";
export const NWS_OBSERVATIONS_USER_AGENT =
  "Gloomberb (https://terminal.kohor.st; weather@kohor.st)";

/** A normalized NWS station-observation feature, with display-ready US units. */
export interface NwsStationObservation {
  provider: typeof NWS_OBSERVATIONS_PROVIDER_ID;
  stationId: string;
  sourceUrl: string | null;
  timestamp: string;
  textDescription: string | null;
  temperatureF: number | null;
  dewpointF: number | null;
  relativeHumidity: number | null;
  windDirectionDeg: number | null;
  windSpeedMph: number | null;
  windGustMph: number | null;
  visibilityMi: number | null;
  barometricPressureInHg: number | null;
  seaLevelPressureInHg: number | null;
  precipitationLastHourIn: number | null;
  precipitationLast3HoursIn: number | null;
  precipitationLast6HoursIn: number | null;
}

export interface NwsStationObservationSet {
  provider: typeof NWS_OBSERVATIONS_PROVIDER_ID;
  seriesId: string;
  icao: string;
  observations: NwsStationObservation[];
}

export interface NwsStationObservationLoadOptions {
  icao: string;
  limit: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}
