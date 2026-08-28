import { withConnectionRequest } from "../../plugins/builtin/connections/register";
import { httpFetch } from "../../utils/http-transport";
import { normalizeIcaoStation } from "../nws-cli/parse";
import {
  aggregateNwsDaily,
  parseNwsObservationCollection,
} from "./parse";
import { normalizeNwsObservationIcao, parseNwsStationObservations } from "./parse-station";
import type {
  NwsDailyAggregate,
  NwsObservationLoadOptions,
  NwsObservationSet,
  NwsStationObservationLoadOptions,
  NwsStationObservationSet,
} from "./types";
import {
  NWS_API,
  NWS_OBSERVATIONS_CONNECTION_ID,
  NWS_OBSERVATIONS_PROVIDER_ID,
  NWS_OBSERVATIONS_USER_AGENT,
} from "./types";

function nwsHeaders(userAgent: string): HeadersInit {
  return {
    Accept: "application/geo+json",
    "User-Agent": userAgent,
  };
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  userAgent: string,
): Promise<unknown> {
  const response = await withConnectionRequest(
    NWS_OBSERVATIONS_CONNECTION_ID,
    "station-observations",
    () => fetchImpl(url, { headers: nwsHeaders(userAgent) }),
  );
  if (!response.ok) {
    throw new Error(`NWS observations request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

/** Load raw NWS station observations from the public observations API. */
export async function loadNwsObservations(
  options: NwsObservationLoadOptions,
): Promise<NwsObservationSet> {
  const icao = normalizeIcaoStation(options.icao);
  if (!icao) throw new Error("ICAO station is required.");
  const fetchImpl = options.fetchImpl ?? httpFetch;
  const userAgent = options.userAgent ?? NWS_OBSERVATIONS_USER_AGENT;
  const limit = options.limit && Number.isFinite(options.limit)
    ? Math.min(Math.max(Math.trunc(options.limit), 1), 500)
    : 200;
  const url = `${NWS_API}/stations/${encodeURIComponent(icao)}/observations?limit=${limit}`;
  const body = await fetchJson(fetchImpl, url, userAgent);
  const observations = parseNwsObservationCollection(body, icao);
  return {
    provider: NWS_OBSERVATIONS_PROVIDER_ID,
    stationId: icao,
    icao,
    observations,
    fetchedAt: Date.now(),
  };
}

/**
 * Load NWS station observations and aggregate them into a daily max/min/precip
 * for the requested calendar date (UTC). Returns null when no observations
 * fall on that date.
 */
export async function loadNwsDailyAggregate(
  options: NwsObservationLoadOptions & { date: string },
): Promise<NwsDailyAggregate | null> {
  const icao = normalizeIcaoStation(options.icao);
  if (!icao) throw new Error("ICAO station is required.");
  const fetchImpl = options.fetchImpl ?? httpFetch;
  const userAgent = options.userAgent ?? NWS_OBSERVATIONS_USER_AGENT;
  const limit = options.limit && Number.isFinite(options.limit)
    ? Math.min(Math.max(Math.trunc(options.limit), 1), 500)
    : 200;
  const sourceUrl = `${NWS_API}/stations/${encodeURIComponent(icao)}/observations?limit=${limit}`;
  const body = await fetchJson(fetchImpl, sourceUrl, userAgent);
  const observations = parseNwsObservationCollection(body, icao);
  const aggregate = aggregateNwsDaily(
    observations,
    icao,
    options.date,
    Date.now(),
    sourceUrl,
  );
  if (aggregate.sampleCount === 0) return null;
  return aggregate;
}

export function nwsStationObservationsUrl(icao: string, limit: number): string {
  return `${NWS_API}/stations/${encodeURIComponent(icao)}/observations?limit=${encodeURIComponent(String(limit))}`;
}

/** Load display-ready ASOS observations for the weather station detail view. */
export async function loadNwsStationObservations(
  options: NwsStationObservationLoadOptions,
): Promise<NwsStationObservationSet> {
  const icao = normalizeNwsObservationIcao(options.icao);
  if (!icao) throw new Error("A four-character ICAO station is required.");
  if (!Number.isFinite(options.limit) || options.limit < 1) {
    throw new Error("Observation limit must be a positive number.");
  }
  const limit = Math.min(Math.trunc(options.limit), 500);
  const fetchImpl = options.fetchImpl ?? httpFetch;
  const userAgent = options.userAgent ?? NWS_OBSERVATIONS_USER_AGENT;
  const url = nwsStationObservationsUrl(icao, limit);
  const body = await fetchJson(fetchImpl, url, userAgent);
  return parseNwsStationObservations(body, icao);
}
