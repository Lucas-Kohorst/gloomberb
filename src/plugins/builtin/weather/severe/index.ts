/**
 * Severe-weather source registry and adapters.
 *
 * Resolves Polymarket / Kalshi markets whose settlement depends on an explicit
 * severe-weather event (hurricane, tornado, drought, wildfire) to the public
 * agency that publishes the authoritative record.
 *
 * @see resolveSevereWeatherSource — main entry point for integrators.
 */

export {
  classifySevereWeatherKind,
  isSevereWeatherMarket,
} from "./classify";
export {
  SEVERE_WEATHER_SOURCE_REGISTRY,
  getSevereWeatherAdapter,
  resolveSevereWeatherSource,
  NHC_ADAPTER,
  SPC_ADAPTER,
  DROUGHT_ADAPTER,
  NIFC_ADAPTER,
} from "./sources";
export type {
  SevereWeatherEventKind,
  SevereWeatherSourceStatus,
  SevereWeatherMarketHints,
  SevereWeatherSourceResult,
  SevereWeatherSourceAdapter,
} from "./types";
