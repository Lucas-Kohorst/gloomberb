export const NWS_OBSERVATIONS_PROVIDER_ID = "nws-observations";
export const NWS_OBSERVATIONS_USER_AGENT =
  "Gloomberb (https://terminal.kohor.st; nws-observations@kohor.st)";

export const NWS_API = "https://api.weather.gov";

/** A single NWS station observation record parsed from the GeoJSON API. */
export interface NwsObservation {
  provider: typeof NWS_OBSERVATIONS_PROVIDER_ID;
  stationId: string;
  icao: string;
  /** ISO-8601 UTC timestamp of the observation. */
  timestamp: string | null;
  /** Air temperature in degrees Fahrenheit, or null when missing. */
  tempF: number | null;
  /** Air temperature in degrees Celsius, or null when missing. */
  tempC: number | null;
  /** 24-hour max temperature in Fahrenheit reported in the observation, if present. */
  maxTempF24h: number | null;
  /** 24-hour min temperature in Fahrenheit reported in the observation, if present. */
  minTempF24h: number | null;
  /** Precipitation in inches for the past hour, if present. */
  precipIn: number | null;
  /** Quality control flag (e.g. "passed", "failed", "notChecked"). */
  qualityControl: string | null;
  /** Source URL of the individual observation feature. */
  sourceUrl: string | null;
}

export interface NwsObservationSet {
  provider: typeof NWS_OBSERVATIONS_PROVIDER_ID;
  stationId: string;
  icao: string;
  observations: NwsObservation[];
  fetchedAt: number;
}

/** Aggregated daily max/min/precip from a station observation timeseries. */
export interface NwsDailyAggregate {
  provider: typeof NWS_OBSERVATIONS_PROVIDER_ID;
  stationId: string;
  icao: string;
  date: string;
  /** Maximum observed temperature in Fahrenheit for the calendar date. */
  maxTempF: number | null;
  /** Minimum observed temperature in Fahrenheit for the calendar date. */
  minTempF: number | null;
  /** Total precipitation in inches for the calendar date. */
  precipIn: number | null;
  /** Number of observations that contributed to the aggregate. */
  sampleCount: number;
  /** Earliest observation timestamp included. */
  firstTimestamp: string | null;
  /** Latest observation timestamp included. */
  lastTimestamp: string | null;
  /** Source URL of the station observations listing. */
  sourceUrl: string | null;
  fetchedAt: number;
}

export interface NwsObservationLoadOptions {
  icao: string;
  /** Optional date filter (YYYY-MM-DD); when omitted all returned observations are included. */
  date?: string;
  /** Limit the number of observations fetched (NWS API default is 200). */
  limit?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}
