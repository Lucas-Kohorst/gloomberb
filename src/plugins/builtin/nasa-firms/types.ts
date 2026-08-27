export const NASA_FIRMS_PLUGIN_ID = "nasa-firms";
export const NASA_FIRMS_CONNECTION_ID = "nasa-firms";
export const NASA_FIRMS_API_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api";

/** Config key for the free FIRMS MAP_KEY (register at https://firms.modaps.eosdis.nasa.gov/api/area/). */
export const NASA_FIRMS_MAP_KEY_CONFIG = "nasaFirmsMapKey";

/**
 * One active fire detection from MODIS or VIIRS.
 *
 * Field names mirror the FIRMS CSV columns. `brightness` is in Kelvin; convert
 * to Celsius for display. `confidence` is a 0-100 number for MODIS or a letter
 * (l/n/h) for VIIRS. `frp` is fire radiative power in MW.
 */
export interface FireDetection {
  latitude: number;
  longitude: number;
  /** Brightness temperature in Kelvin. */
  brightness: number;
  /** Scan resolution in degrees. */
  scan: number;
  /** Track resolution in degrees. */
  track: number;
  /** Acquisition date (YYYY-MM-DD). */
  acqDate: string;
  /** Acquisition time (HHMM or HH:MM UTC). */
  acqTime: string;
  /** Satellite: Terra/Aqua (MODIS) or NPP/NOAA20 (VIIRS). */
  satellite: string;
  /** Confidence: 0-100 number (MODIS) or l/n/h letter (VIIRS). */
  confidence: string;
  /** Fire radiative power in MW. */
  frp: number;
  /** Day or night flag: "D" or "N". */
  dayNight: string;
}

/** A page of fire detection results. */
export interface FirePage {
  detections: FireDetection[];
  total: number;
}
