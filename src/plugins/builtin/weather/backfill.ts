import {
  WEATHER_ARCHIVE_DAYS,
  addUtcDays,
  findWeatherDayRecord,
  type WeatherArchiveImplied,
  type WeatherArchiveObservation,
  type WeatherArchiveState,
} from "./archive";
import { loadKalshiImpliedHighAtLocalMidnight } from "./kalshi-forecast";
import { kalshiHighSeriesForStation } from "./mapping";
import { WEATHER_STATIONS } from "./stations";
import type { WeatherDailyObservation, WeatherStation } from "./types";

const BACKFILL_CONCURRENCY = 2;
const DEFAULT_BACKFILL_STATIONS = WEATHER_STATIONS.filter((station) => station.scope === "domestic");

export interface WeatherImpliedBackfillJob {
  stationId: string;
  date: string;
  timeZone: string;
}

export function officialArchiveObservations(
  observations: readonly WeatherDailyObservation[],
): WeatherArchiveObservation[] {
  return observations.flatMap((row) => {
    if (!row.official && row.status !== "official") return [];
    if (row.maxTemp == null) return [];
    return [{
      stationId: row.stationId,
      date: row.date,
      high: row.maxTemp,
      official: true,
    }];
  });
}

export function impliedBackfillJobs(
  archive: WeatherArchiveState,
  today: string,
  stations: readonly WeatherStation[] = DEFAULT_BACKFILL_STATIONS,
  days = WEATHER_ARCHIVE_DAYS,
): WeatherImpliedBackfillJob[] {
  const jobs: WeatherImpliedBackfillJob[] = [];
  for (let offset = 1; offset < days; offset += 1) {
    const date = addUtcDays(today, -offset);
    for (const station of stations) {
      if (!kalshiHighSeriesForStation(station.id)) continue;
      const record = findWeatherDayRecord(archive, station.id, date);
      if (record?.impliedHigh != null) continue;
      jobs.push({
        stationId: station.id,
        date,
        timeZone: station.timezone || "UTC",
      });
    }
  }
  return jobs;
}

async function mapPool<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export async function loadImpliedBackfill(
  jobs: readonly WeatherImpliedBackfillJob[],
  options?: {
    concurrency?: number;
    onBatch?: (rows: WeatherArchiveImplied[]) => void | Promise<void>;
    isCancelled?: () => boolean;
  },
): Promise<WeatherArchiveImplied[]> {
  const concurrency = options?.concurrency ?? BACKFILL_CONCURRENCY;
  const collected: WeatherArchiveImplied[] = [];
  await mapPool(jobs, concurrency, async (job) => {
    if (options?.isCancelled?.()) return;
    const row = await loadKalshiImpliedHighAtLocalMidnight(job.stationId, job.date, job.timeZone).catch(() => null);
    if (!row || options?.isCancelled?.()) return;
    collected.push(row);
    await options?.onBatch?.([row]);
  });
  return collected;
}
