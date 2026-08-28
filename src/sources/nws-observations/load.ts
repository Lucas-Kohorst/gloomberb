import { withConnectionRequest } from "../../plugins/builtin/connections/register";
import { httpFetch } from "../../utils/http-transport";
import { normalizeNwsObservationIcao, parseNwsStationObservations } from "./parse";
import {
  NWS_OBSERVATIONS_CONNECTION_ID,
  NWS_OBSERVATIONS_USER_AGENT,
  type NwsStationObservationLoadOptions,
  type NwsStationObservationSet,
} from "./types";

const NWS_API = "https://api.weather.gov";
const MAX_LIMIT = 500;

/**
 * A hosted browser should call a same-origin Worker proxy for this endpoint:
 * direct api.weather.gov access can be restricted by CORS and browsers cannot
 * send the identifying User-Agent header required by NWS API policy.
 */
export const NWS_OBSERVATIONS_HOSTED_INTEGRATION_NOTE =
  "Route hosted requests through a same-origin Worker proxy that adds the NWS User-Agent.";

export function nwsStationObservationsUrl(icao: string, limit: number): string {
  return `${NWS_API}/stations/${encodeURIComponent(icao)}/observations?limit=${encodeURIComponent(String(limit))}`;
}

export async function loadNwsStationObservations(
  options: NwsStationObservationLoadOptions,
): Promise<NwsStationObservationSet> {
  const icao = normalizeNwsObservationIcao(options.icao);
  if (!icao) throw new Error("A four-character ICAO station is required.");
  if (!Number.isFinite(options.limit) || options.limit < 1) {
    throw new Error("Observation limit must be a positive number.");
  }
  const limit = Math.min(Math.trunc(options.limit), MAX_LIMIT);
  const fetchImpl = options.fetchImpl ?? httpFetch;
  const userAgent = options.userAgent ?? NWS_OBSERVATIONS_USER_AGENT;

  return withConnectionRequest(NWS_OBSERVATIONS_CONNECTION_ID, "station-observations", async () => {
    const response = await fetchImpl(nwsStationObservationsUrl(icao, limit), {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": userAgent,
      },
    });
    if (!response.ok) {
      throw new Error(`NWS station observations request failed (${response.status}) for ${icao}`);
    }
    return parseNwsStationObservations(await response.json(), icao);
  });
}
