/**
 * Kalshi Weather Calibrations client.
 *
 * Thin wrapper over HEAD's {@link ./kalshi-index}, which already loads
 * `GET /trade-api/v2/live_data/weather/{city}/calibrations`. Calibrations are
 * append-only and cached for 1 hour in the index client.
 */

import {
  kalshiWeatherCalibrationUrl,
  loadKalshiWeatherCalibrations,
  loadKalshiWeatherCalibrationsForStation,
  normalizeKalshiWeatherCalibration,
  resetKalshiWeatherCaches,
  type KalshiWeatherCalibration,
  type KalshiWeatherCalibrationTimeline,
} from "./kalshi-index";

export {
  kalshiWeatherCalibrationUrl as kalshiWeatherCalibrationsUrl,
  loadKalshiWeatherCalibrations,
  loadKalshiWeatherCalibrationsForStation,
  normalizeKalshiWeatherCalibration as normalizeKalshiCalibration,
};
export type {
  KalshiWeatherCalibration as KalshiCalibration,
  KalshiWeatherCalibrationTimeline,
};

/** Load the calibration timeline for a city index, oldest to newest. */
export async function loadKalshiCalibrations(cityId: string): Promise<KalshiWeatherCalibration[]> {
  const timeline = await loadKalshiWeatherCalibrations(cityId);
  return timeline.calibrations;
}

export function resetKalshiCalibrationsCache(): void {
  resetKalshiWeatherCaches();
}
