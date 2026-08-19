import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import type { NwsCliPrint, NwsCliPrintSet } from "../../../sources/nws-cli/types";
import { NWS_CLI_USER_AGENT } from "../../../sources/nws-cli/types";
import { normalizeIcaoStation } from "../../../sources/nws-cli/parse";
import { loadNwsCliPrints } from "../../../sources/nws-cli/load";
import { ADJACENT_CLOUD_CONNECTION_ID, isHostedWebClient } from "../connections/adjacent-cloud";
import { findWeatherStation } from "./stations";
import type { WeatherMetric } from "./types";

function nwsRequestUrl(icao: string, query: string): string {
  return `/api/data/nws-cli/${encodeURIComponent(icao)}${query}`;
}

const NWS_FETCH = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 400,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": NWS_CLI_USER_AGENT,
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

export function nwsIcaoForStation(token: string): string | null {
  const station = findWeatherStation(token);
  if (station) return station.icao;
  return normalizeIcaoStation(token);
}

async function fetchHostedPrints(icao: string, search: string): Promise<NwsCliPrint[]> {
  const response = await NWS_FETCH.fetch(nwsRequestUrl(icao, search));
  if (!response.ok) {
    throw new Error(`NWS CLI request failed (${response.status})`);
  }
  const body = await response.json() as NwsCliPrint | NwsCliPrintSet;
  if (body && typeof body === "object" && "prints" in body && Array.isArray(body.prints)) {
    return body.prints;
  }
  if (body && typeof body === "object" && "icao" in body) return [body as NwsCliPrint];
  return [];
}

export async function fetchNwsCliHistory(stationToken: string, days = 30): Promise<NwsCliPrint[]> {
  const icao = nwsIcaoForStation(stationToken);
  if (!icao) throw new Error("Unknown ICAO station.");
  return withConnectionRequest(ADJACENT_CLOUD_CONNECTION_ID, "cli-history", async () => {
    if (isHostedWebClient()) {
      return fetchHostedPrints(icao, `?days=${encodeURIComponent(String(days))}`);
    }
    const set = await loadNwsCliPrints({
      icao,
      days,
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return NWS_FETCH.fetch(url, init);
      }) as typeof fetch,
    });
    return set.prints;
  });
}

export async function loadNwsCliSeries(
  stationToken: string,
  metric: WeatherMetric,
): Promise<{
  points: Array<{ date: Date; value: number }>;
  label: string;
  unit: string;
  unitGroup: string;
}> {
  if (metric === "hourly") {
    throw new Error("NWS CLI is a daily climate print; use WX:{station}:hourly for TWC METAR.");
  }
  const icao = nwsIcaoForStation(stationToken);
  if (!icao) throw new Error("Unknown ICAO station.");
  const station = findWeatherStation(icao);
  const prints = await fetchNwsCliHistory(icao);
  const points = prints.flatMap((print) => {
    const value = metric === "low" ? print.lowF : metric === "precip" ? print.precipIn : print.highF;
    if (value == null) return [];
    const date = new Date(`${print.date}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return [];
    return [{ date, value }];
  });
  return {
    points,
    label: `${station?.city ?? icao} NWS ${metric}`,
    unit: metric === "precip" ? "in" : "°F",
    unitGroup: metric === "precip" ? "weather-precip" : "weather-temp",
  };
}
