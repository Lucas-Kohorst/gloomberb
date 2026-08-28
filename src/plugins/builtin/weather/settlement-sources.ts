/**
 * Authoritative weather settlement-source adapters.
 *
 * Each adapter wraps a public settlement data source and returns a unified
 * {@link WeatherSettlementRecord} with clear source/revision metadata so the
 * caller can display provenance alongside the value without reaching into
 * source-specific internals.
 *
 * Sources:
 *  - NWS CLI daily climate reports (high/low/precip) — `src/sources/nws-cli`
 *  - NOAA/NWS station observations timeseries (max/min by date) — `src/sources/nws-observations`
 *  - Kalshi Weather Company hourly METAR — `src/plugins/builtin/weather/client`
 */

import { loadNwsDailyAggregate } from "../../../sources/nws-observations/load";
import type { NwsCliPrint } from "../../../sources/nws-cli/types";
import type { NwsDailyAggregate } from "../../../sources/nws-observations/types";
import { NWS_OBSERVATIONS_USER_AGENT } from "../../../sources/nws-observations/types";
import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import { fetchNwsCliHistory, nwsIcaoForStation } from "./nws-client";
import { findWeatherStation } from "./stations";
import {
  NWS_OBSERVATIONS_CONNECTION_ID,
  type WeatherHourlyObservation,
  type WeatherMetric,
} from "./types";

/** Identifies the authoritative settlement source. */
export type SettlementSourceId = "nws-cli" | "nws-observations" | "twc-kalshi";

export interface SettlementSourceMeta {
  source: SettlementSourceId;
  /** Human-readable source name for display. */
  sourceName: string;
  /** Revision identifier: NWS product id, observation timestamp, or fetchedAt. */
  revision: string | null;
  /** When the settlement data was fetched (epoch ms). */
  fetchedAt: number;
  /** URL to the authoritative source document. */
  sourceUrl: string | null;
  /** Whether the record is an official/final print vs preliminary/pending. */
  official: boolean;
  /** Free-text status from the source (e.g. "official", "preliminary", "settled"). */
  status: string | null;
}

export interface WeatherSettlementRecord {
  stationId: string;
  icao: string;
  date: string;
  metric: WeatherMetric;
  /** The settlement value in the source's native unit (°F or inches). */
  value: number | null;
  /** Secondary values when the source reports multiple (e.g. high and low). */
  high: number | null;
  low: number | null;
  precip: number | null;
  /** For hourly records, the local hour of the observation. */
  hourLocal: number | null;
  meta: SettlementSourceMeta;
}

const NWS_OBS_FETCH = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 400,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/geo+json",
    "User-Agent": NWS_OBSERVATIONS_USER_AGENT,
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

// ---------------------------------------------------------------------------
// Pure mapping functions (exported for direct testing)
// ---------------------------------------------------------------------------

export function cliPrintToSettlementRecord(
  print: NwsCliPrint,
  stationId: string,
  metric: WeatherMetric,
  fetchedAt = Date.now(),
): WeatherSettlementRecord {
  const value = metric === "low" ? print.lowF : metric === "precip" ? print.precipIn : print.highF;
  return {
    stationId,
    icao: print.icao,
    date: print.date,
    metric,
    value,
    high: print.highF,
    low: print.lowF,
    precip: print.precipIn,
    hourLocal: null,
    meta: {
      source: "nws-cli",
      sourceName: "NWS Daily Climate Report (CLI)",
      revision: print.productId,
      fetchedAt,
      sourceUrl: print.sourceUrl,
      official: print.printKind === "final",
      status: print.printKind,
    },
  };
}

export function dailyAggregateToSettlementRecord(
  aggregate: NwsDailyAggregate,
  stationId: string,
  metric: WeatherMetric,
): WeatherSettlementRecord {
  const value = metric === "low" ? aggregate.minTempF : metric === "precip" ? aggregate.precipIn : aggregate.maxTempF;
  return {
    stationId,
    icao: aggregate.icao,
    date: aggregate.date,
    metric,
    value,
    high: aggregate.maxTempF,
    low: aggregate.minTempF,
    precip: aggregate.precipIn,
    hourLocal: null,
    meta: {
      source: "nws-observations",
      sourceName: "NOAA/NWS Station Observations",
      revision: aggregate.lastTimestamp,
      fetchedAt: aggregate.fetchedAt,
      sourceUrl: aggregate.sourceUrl,
      official: aggregate.sampleCount > 0,
      status: aggregate.sampleCount > 0 ? `${aggregate.sampleCount} observations` : null,
    },
  };
}

export function hourlyObservationToSettlementRecord(
  obs: WeatherHourlyObservation,
  stationId: string,
  icao: string,
  date: string,
  fetchedAt = Date.now(),
): WeatherSettlementRecord {
  return {
    stationId,
    icao,
    date: obs.date || date,
    metric: "hourly",
    value: obs.tempF,
    high: obs.tempF,
    low: obs.tempF,
    precip: null,
    hourLocal: obs.hourLocal,
    meta: {
      source: "twc-kalshi",
      sourceName: "Kalshi Weather Company (TWC METAR)",
      revision: obs.reportTimeUtc,
      fetchedAt,
      sourceUrl: null,
      official: obs.status === "settled" || obs.status === "official",
      status: obs.status,
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter functions (wrap source modules with connection reporting)
// ---------------------------------------------------------------------------

/**
 * Load the authoritative NWS CLI daily climate report (high/low/precip) for a
 * station and date. This is the first-final daily climate print that Kalshi
 * high/low markets settle against. Reuses the shared NWS CLI fetch path.
 */
export async function loadNwsCliSettlement(
  stationId: string,
  date: string,
  metric: WeatherMetric = "high",
): Promise<WeatherSettlementRecord | null> {
  if (metric === "hourly") {
    throw new Error("NWS CLI is a daily climate print; use loadTwcHourlySettlement for hourly.");
  }
  const icao = nwsIcaoForStation(stationId);
  if (!icao) throw new Error(`Unknown ICAO station for ${stationId}.`);
  const prints = await fetchNwsCliHistory(icao);
  const print = prints.find((row) => row.date === date) ?? null;
  if (!print) return null;
  return cliPrintToSettlementRecord(print, stationId, metric);
}

/**
 * Load NOAA/NWS station observation timeseries and aggregate them into a daily
 * max/min/precip for the requested date. This is the public observations API
 * that backs NWS station records when a CLI print is not yet available.
 */
export async function loadNwsObservationsSettlement(
  stationId: string,
  date: string,
  metric: WeatherMetric = "high",
): Promise<WeatherSettlementRecord | null> {
  if (metric === "hourly") {
    throw new Error("NWS observations daily aggregate is not hourly; use loadTwcHourlySettlement.");
  }
  const icao = nwsIcaoForStation(stationId);
  if (!icao) throw new Error(`Unknown ICAO station for ${stationId}.`);
  return withConnectionRequest(NWS_OBSERVATIONS_CONNECTION_ID, "observations-settlement", async () => {
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return NWS_OBS_FETCH.fetch(url, init);
    }) as typeof fetch;
    const aggregate = await loadNwsDailyAggregate({ icao, date, fetchImpl });
    if (!aggregate) return null;
    return dailyAggregateToSettlementRecord(aggregate, stationId, metric);
  });
}

/**
 * Load Kalshi Weather Company hourly METAR observations for a station. When
 * `hour` is provided, the record targets that local hour; otherwise the most
 * recent observation for the date is returned.
 */
export async function loadTwcHourlySettlement(
  stationId: string,
  date: string,
  hour?: number,
): Promise<WeatherSettlementRecord | null> {
  const station = findWeatherStation(stationId);
  if (!station) throw new Error(`Unknown weather station ${stationId}.`);
  const { loadWeatherHourly } = await import("./client");
  const observations = await loadWeatherHourly(stationId);
  const filtered = observations.filter((row) => !date || row.date === date);
  const target = hour != null
    ? filtered.find((row) => row.hourLocal === hour) ?? null
    : filtered[filtered.length - 1] ?? null;
  if (!target) return null;
  return hourlyObservationToSettlementRecord(target, stationId, station.icao, date);
}

/**
 * Load the best available settlement record across all sources for a metric.
 * For daily metrics, prefers the authoritative NWS CLI print and falls back to
 * observation aggregation. For hourly, delegates to the TWC adapter.
 */
export async function loadSettlementRecord(
  stationId: string,
  date: string,
  metric: WeatherMetric,
  hour?: number,
): Promise<WeatherSettlementRecord | null> {
  if (metric === "hourly") {
    return loadTwcHourlySettlement(stationId, date, hour);
  }
  const cli = await loadNwsCliSettlement(stationId, date, metric).catch(() => null);
  if (cli && cli.value != null) return cli;
  const obs = await loadNwsObservationsSettlement(stationId, date, metric).catch(() => null);
  if (obs && obs.value != null) return obs;
  return cli ?? obs ?? null;
}

export function settlementSourceLabel(source: SettlementSourceId): string {
  switch (source) {
    case "nws-cli": return "NWS CLI";
    case "nws-observations": return "NWS Observations";
    case "twc-kalshi": return "TWC Kalshi";
  }
}
