/**
 * Live weather polling hook.
 *
 * Polls a station's NWS METAR observation feed, the TWC settlement feed, and
 * the Kalshi city weather index (when Kalshi publishes one for the station).
 * Readings accumulate into a growing, deduped array so the Live tab fills in
 * over the session. `refresh()` forces an immediate pull.
 *
 * ASOS publishes every five minutes and the Kalshi index every minute, so the
 * poll runs on a one-minute cadence to stay level with the feeds.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { aggregateMonthlyDegreeDays, computeDailyDegreeDays } from "./degree-days";
import { loadKalshiWeatherIndexForStation } from "./kalshi-index";
import { loadNwsObservations } from "./nws-observations";
import { findWeatherStation } from "./stations";
import { loadTwcHourly } from "./twc-client";
import type { DegreeDayReading, WeatherMetric, WeatherObservation } from "./types";

export const WEATHER_POLL_INTERVAL_MS = 60_000;

/** Cap accumulation at roughly two days of minute-resolution index points. */
const MAX_ACCUMULATED_OBSERVATIONS = 3000;

export interface WeatherPollingResult {
  /** Accumulated readings, oldest to newest. */
  observations: WeatherObservation[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => void;
  degreeDays: DegreeDayReading | null;
}

function observationKey(obs: WeatherObservation): string {
  return `${obs.source}:${obs.timestamp}`;
}

/** Merge incoming readings into the accumulated set, deduped by source+time. */
export function mergeWeatherObservations(
  existing: readonly WeatherObservation[],
  incoming: readonly WeatherObservation[],
): WeatherObservation[] {
  if (incoming.length === 0) return [...existing];
  const byKey = new Map<string, WeatherObservation>();
  for (const obs of existing) byKey.set(observationKey(obs), obs);
  for (const obs of incoming) byKey.set(observationKey(obs), obs);
  const merged = [...byKey.values()].sort((left, right) => left.timestamp - right.timestamp);
  return merged.length > MAX_ACCUMULATED_OBSERVATIONS
    ? merged.slice(merged.length - MAX_ACCUMULATED_OBSERVATIONS)
    : merged;
}

export function useWeatherPolling(
  stationId: string,
  metric: WeatherMetric = "hourly",
  intervalMs: number = WEATHER_POLL_INTERVAL_MS,
): WeatherPollingResult {
  const [observations, setObservations] = useState<WeatherObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [degreeDays, setDegreeDays] = useState<DegreeDayReading | null>(null);
  const generationRef = useRef(0);
  const accumulatedRef = useRef<WeatherObservation[]>([]);

  // Switching stations starts a fresh accumulation.
  useEffect(() => {
    accumulatedRef.current = [];
    setObservations([]);
    setError(null);
    setLastUpdated(null);
    setDegreeDays(null);
  }, [stationId]);

  const load = useCallback(async () => {
    const station = findWeatherStation(stationId);
    const generation = ++generationRef.current;
    if (!station) {
      accumulatedRef.current = [];
      setObservations([]);
      setError(`Unknown weather station ${stationId}.`);
      setLoading(false);
      return;
    }
    setLoading(true);

    const [nwsResult, kalshiResult, twcResult] = await Promise.allSettled([
      loadNwsObservations(station.icao),
      loadKalshiWeatherIndexForStation(station.id),
      loadTwcHourly(station.id),
    ]);
    if (generationRef.current !== generation) return;

    const incoming: WeatherObservation[] = [];
    if (nwsResult.status === "fulfilled") {
      for (const obs of nwsResult.value) {
        const timestamp = Date.parse(obs.timestamp);
        if (!Number.isFinite(timestamp)) continue;
        incoming.push({
          stationId: station.id,
          source: "nws-observations",
          timestamp,
          tempF: obs.tempF ?? undefined,
          dewpointF: obs.dewpointF ?? undefined,
          humidityPct: obs.humidityPct ?? undefined,
          precipIn: obs.precipIn ?? undefined,
          status: "final",
          metric,
        });
      }
    }
    if (kalshiResult.status === "fulfilled" && kalshiResult.value) {
      for (const point of kalshiResult.value.points) {
        incoming.push({
          stationId: station.id,
          source: "kalshi-index",
          timestamp: point.timestampMs,
          tempF: point.complete && point.valueF != null ? point.valueF : undefined,
          status: point.complete ? "final" : "pending",
          metric,
        });
      }
    }
    if (twcResult.status === "fulfilled") {
      for (const obs of twcResult.value) incoming.push(obs);
    }

    const failures = [nwsResult, kalshiResult, twcResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

    const merged = mergeWeatherObservations(accumulatedRef.current, incoming);
    accumulatedRef.current = merged;
    setObservations(merged);
    setLastUpdated(Date.now());
    setLoading(false);
    setError(failures[0] ?? null);

    const todayStr = new Date().toISOString().slice(0, 10);
    const dailyHddCdd = new Map<string, { highF: number; lowF: number }>();
    for (const obs of merged) {
      if (obs.source !== "nws-observations" || obs.tempF == null) continue;
      const date = new Date(obs.timestamp).toISOString().slice(0, 10);
      const existing = dailyHddCdd.get(date);
      if (!existing) {
        dailyHddCdd.set(date, { highF: obs.tempF, lowF: obs.tempF });
      } else {
        if (obs.tempF > existing.highF) existing.highF = obs.tempF;
        if (obs.tempF < existing.lowF) existing.lowF = obs.tempF;
      }
    }

    const todayHL = dailyHddCdd.get(todayStr);
    let computedDegreeDays: DegreeDayReading | null = null;
    if (todayHL) {
      const { hdd, cdd } = computeDailyDegreeDays(todayHL.highF, todayHL.lowF);
      const monthPrefix = todayStr.slice(0, 7);
      const dailyReadings: DegreeDayReading[] = [];
      for (const [date, hl] of dailyHddCdd) {
        if (!date.startsWith(monthPrefix)) continue;
        const day = computeDailyDegreeDays(hl.highF, hl.lowF);
        dailyReadings.push({
          date,
          stationId,
          highF: hl.highF,
          lowF: hl.lowF,
          avgF: (hl.highF + hl.lowF) / 2,
          hdd: day.hdd,
          cdd: day.cdd,
          monthlyCumulativeHdd: day.hdd,
          monthlyCumulativeCdd: day.cdd,
          dayCount: 1,
        });
      }
      const month = aggregateMonthlyDegreeDays(dailyReadings);
      computedDegreeDays = {
        date: todayStr,
        stationId,
        highF: todayHL.highF,
        lowF: todayHL.lowF,
        avgF: (todayHL.highF + todayHL.lowF) / 2,
        hdd,
        cdd,
        monthlyCumulativeHdd: month.monthlyHdd,
        monthlyCumulativeCdd: month.monthlyCdd,
        dayCount: month.dayCount,
      };
    }
    setDegreeDays(computedDegreeDays);
  }, [stationId, metric]);

  useEffect(() => {
    void load();
    if (!(intervalMs > 0)) return;
    const timer = setInterval(() => {
      void load();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [load, intervalMs]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { observations, loading, error, lastUpdated, refresh, degreeDays };
}
