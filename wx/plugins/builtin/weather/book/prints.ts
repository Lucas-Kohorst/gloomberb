import { loadNwsStationObservations } from "../../../../../src/sources/nws-observations";
import { zonedMidnightUtcMs } from "../../../../../src/plugins/builtin/weather/mapping";
import {
  canonicalWeatherStationId,
  findWeatherStation,
} from "../../../../../src/plugins/builtin/weather/stations";
import type { NwsPrintPoint, NwsPrintSeries } from "./types";

const PRINT_CACHE_TTL_MS = 60_000;
const NWS_WINDOW_LIMIT = 500;

interface CacheEntry {
  expiresAt: number;
  value: NwsPrintSeries;
}

const printCache = new Map<string, CacheEntry>();

export async function loadNwsPrintSeries(
  stationId: string,
  date: string,
  now = Date.now(),
): Promise<NwsPrintSeries> {
  const canonical = canonicalWeatherStationId(stationId) ?? stationId.trim().toUpperCase();
  const station = findWeatherStation(canonical);
  const icao = station?.icao ?? `K${canonical}`;
  const timeZone = station?.timezone ?? "UTC";
  const cacheKey = `${icao}:${date}`;
  const cached = printCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const startMs = zonedMidnightUtcMs(date, timeZone);
  const endMs = startMs + 24 * 60 * 60_000;
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const loaded = await loadNwsStationObservations({
    icao,
    limit: NWS_WINDOW_LIMIT,
    start,
    end,
  }).catch(() => null);

  const points: NwsPrintPoint[] = [];
  for (const observation of loaded?.observations ?? []) {
    const t = Date.parse(observation.timestamp);
    if (!Number.isFinite(t) || observation.temperatureF == null || !Number.isFinite(observation.temperatureF)) {
      continue;
    }
    points.push({ t, tempF: observation.temperatureF, source: "nws-asos" });
  }
  points.sort((left, right) => left.t - right.t);
  const dayHighF = points.reduce<number | null>(
    (max, point) => (max == null || point.tempF > max ? point.tempF : max),
    null,
  );
  const value: NwsPrintSeries = {
    stationId: canonical,
    icao,
    date,
    points,
    dayHighF,
    coverage: points.length > 0 ? "asos-5min" : "empty",
    fetchedAt: now,
  };
  printCache.set(cacheKey, { value, expiresAt: now + PRINT_CACHE_TTL_MS });
  return value;
}

export function resetNwsPrintSeriesCache(): void {
  printCache.clear();
}
