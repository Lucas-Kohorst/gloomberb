import { normalizeIcaoStation } from "../nws-cli/parse";
import {
  aggregateNwsDaily,
  parseNwsObservationCollection,
} from "./parse";
import type {
  NwsDailyAggregate,
  NwsObservation,
  NwsObservationLoadOptions,
  NwsObservationSet,
} from "./types";
import {
  NWS_API,
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
  const response = await fetchImpl(url, { headers: nwsHeaders(userAgent) });
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
  const fetchImpl = options.fetchImpl ?? fetch;
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
  const fetchImpl = options.fetchImpl ?? fetch;
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
