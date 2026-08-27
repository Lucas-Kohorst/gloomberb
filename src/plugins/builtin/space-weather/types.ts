export const SPACE_WEATHER_PLUGIN_ID = "space-weather";
export const SPACE_WEATHER_CONNECTION_ID = "space-weather";

/** Base URL for the NOAA SWPC JSON data services. */
export const SPACE_WEATHER_API_BASE_URL = "https://services.swpc.noaa.gov";

/** NOAA SWPC website for the [o]pen external link. */
export const SWPC_WEBSITE_URL = "https://www.swpc.noaa.gov/";

/** One planetary K-index reading (3-hour cadence). */
export interface KpReading {
  timeTag: Date;
  kp: number;
  estimatedKp: number;
  kpShort: string;
}

/** One solar-wind magnetic-field reading (5-minute cadence). */
export interface SolarWindReading {
  timeTag: Date;
  bx: number;
  by: number;
  bz: number;
  bt: number;
}

/** One GOES X-ray flare event from the last day. */
export interface XrayFlare {
  timeTag: Date;
  classType: string;
  intensity: number;
  beginTime: Date | null;
  maxTime: Date | null;
  endTime: Date | null;
}

/** Combined snapshot of all three SWPC data feeds. */
export interface SpaceWeatherData {
  kpReadings: KpReading[];
  solarWind: SolarWindReading[];
  flares: XrayFlare[];
}
