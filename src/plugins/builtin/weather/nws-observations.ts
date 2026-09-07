/**
 * NWS station observations (METAR) plugin entry.
 *
 * Thin wrapper over `src/sources/nws-observations`. Callers pass an ICAO
 * token and an optional `limit` (default 500, NWS max). The shared source
 * owns fetch, parse, and Connections reporting.
 */

import {
  loadNwsDailyAggregate as loadNwsDailyAggregateSource,
  loadNwsStationObservations,
  parseNwsObservationFeature,
  aggregateNwsDaily,
  NWS_OBSERVATIONS_CONNECTION_ID,
  NWS_OBSERVATIONS_USER_AGENT,
  type NwsDailyAggregate,
  type NwsStationObservation,
} from "../../../sources/nws-observations";
import { normalizeIcaoStation, nwsIcaoForStation } from "./nws-cli";

export {
  NWS_OBSERVATIONS_CONNECTION_ID,
  NWS_OBSERVATIONS_USER_AGENT,
  parseNwsObservationFeature,
  aggregateNwsDaily,
};
export type { NwsDailyAggregate };

/** NWS API hard-caps the observations listing at 500. */
export const NWS_OBSERVATIONS_DEFAULT_LIMIT = 500;

/** One NWS station observation in the plugin's polling/degree-day shape. */
export interface NwsObservation {
  icao: string;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  tempF: number | null;
  dewpointF: number | null;
  humidityPct: number | null;
  precipIn: number | null;
  sourceUrl: string | null;
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return NWS_OBSERVATIONS_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), NWS_OBSERVATIONS_DEFAULT_LIMIT);
}

function resolveIcao(icao: string): string {
  const normalized = normalizeIcaoStation(icao) ?? nwsIcaoForStation(icao);
  if (!normalized) throw new Error(`Unknown ICAO station for ${icao}.`);
  return normalized;
}

function toPluginObservation(icao: string, obs: NwsStationObservation): NwsObservation {
  return {
    icao,
    timestamp: obs.timestamp,
    tempF: obs.temperatureF,
    dewpointF: obs.dewpointF,
    humidityPct: obs.relativeHumidity,
    precipIn: obs.precipitationLastHourIn,
    sourceUrl: obs.sourceUrl,
  };
}

/**
 * Load recent NWS station observations, sorted oldest to newest.
 * `opts.limit` defaults to {@link NWS_OBSERVATIONS_DEFAULT_LIMIT}.
 */
export async function loadNwsObservations(
  icao: string,
  opts: { limit?: number } = {},
): Promise<NwsObservation[]> {
  const normalizedIcao = resolveIcao(icao);
  const snapshot = await loadNwsStationObservations({
    icao: normalizedIcao,
    limit: clampLimit(opts.limit),
  });
  return snapshot.observations
    .map((obs) => toPluginObservation(normalizedIcao, obs))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

/**
 * Load observations and aggregate them into a daily high/low/precip for
 * `date` (YYYY-MM-DD). Returns null when no observations cover the date.
 */
export async function loadNwsDailyAggregate(
  icao: string,
  date: string,
  opts: { limit?: number } = {},
): Promise<NwsDailyAggregate | null> {
  return loadNwsDailyAggregateSource({
    icao: resolveIcao(icao),
    date,
    limit: clampLimit(opts.limit),
  });
}
