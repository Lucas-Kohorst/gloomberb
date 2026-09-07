/**
 * Weather metric tokens shared by the chart-composer expression parser
 * (`WX:station:metric`, `NWS:icao:metric`) and the pane UI.
 *
 * Implementations live in {@link ./mapping}; this module is the dedicated
 * metric-token entry point so callers do not have to pull the settlement mapper.
 */

export { parseWeatherMetric, weatherMetricLabel } from "./mapping";
