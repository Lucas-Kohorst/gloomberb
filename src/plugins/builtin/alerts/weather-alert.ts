import {
  evaluateObservedThresholdCrossing,
  evaluatePreliminaryToFinal,
  evaluateSourceDiscrepancy,
  evaluateStaleSource,
  type WeatherAlertEvaluation,
  type WeatherObservation,
} from "./weather";
import type { AlertRule } from "./types";
import { fetchPrimaryClimate, fetchInternationalClimate, fetchMetarObservations } from "../weather/client";
import { observationValue } from "../weather/normalize";
import { fetchNwsCliHistory } from "../weather/nws-client";
import { findWeatherStation } from "../weather/stations";
import { zonedDateKey } from "../weather/mapping";

function dailyObservation(alert: AlertRule, now: number): Promise<WeatherObservation | null> {
  const weather = alert.weather!;
  const station = findWeatherStation(weather.stationId);
  const date = zonedDateKey(station?.timezone ?? "UTC", now);
  return (station?.scope === "international" ? fetchInternationalClimate(date, now) : fetchPrimaryClimate(date, now))
    .then((snapshot) => {
      const row = snapshot.observations.find((item) => item.stationId === weather.stationId);
      const metric = weather.condition.kind === "observed-threshold-crossing"
        ? weather.condition.metric
        : weather.condition.kind === "preliminary-to-final" ? weather.condition.metric
        : weather.condition.kind === "source-discrepancy" ? weather.condition.metric
        : null;
      const value = row && metric ? observationValue(row, metric as "high" | "low" | "precip") : 0;
      if (!row || value == null) return null;
      return {
        sourceId: "twc-kalshi",
        observationId: `${row.stationId}:${row.date}:${weather.condition.kind}`,
        observedAt: snapshot.fetchedAt,
        metric: weather.condition.kind === "observed-threshold-crossing" ? weather.condition.metric : "",
        value,
        status: row.status === "official" ? "final" : row.status === "preliminary" ? "preliminary" : undefined,
      };
    });
}

async function currentObservation(alert: AlertRule, now: number): Promise<WeatherObservation | null> {
  const weather = alert.weather!;
  if (weather.condition.kind === "stale-source") {
    const station = findWeatherStation(weather.stationId);
    const date = zonedDateKey(station?.timezone ?? "UTC", now);
    const snapshot = station?.scope === "international"
      ? await fetchInternationalClimate(date, now)
      : await fetchPrimaryClimate(date, now);
    return { sourceId: "twc-kalshi", observationId: `${weather.stationId}:${date}`, observedAt: snapshot.fetchedAt, metric: "", value: 0 };
  }
  if (weather.condition.kind === "observed-threshold-crossing" && weather.condition.metric === "hourly") {
    const rows = await fetchMetarObservations(findWeatherStation(weather.stationId)?.scope === "international" ? "international" : "primary", now);
    const row = rows.observations.filter((item) => item.stationId === weather.stationId && item.tempF != null).at(-1);
    if (!row || row.tempF == null) return null;
    return {
      sourceId: "twc-metar",
      observationId: `${row.stationId}:${row.reportTimeUtc ?? rows.fetchedAt}`,
      observedAt: Date.parse(row.reportTimeUtc ?? "") || rows.fetchedAt,
      metric: "hourly",
      value: row.tempF,
    };
  }
  return dailyObservation(alert, now);
}

/** Evaluates the weather conditions backed by the Weather plugin's existing sources. */
export async function evaluateWeatherAlert(alert: AlertRule, now = Date.now()): Promise<(WeatherAlertEvaluation & {
  observation: WeatherObservation;
}) | null> {
  if (alert.status !== "active" || alert.condition !== "weather" || !alert.weather) return null;
  const condition = alert.weather.condition;
  const current = await currentObservation(alert, now);
  if (!current) return null;
  if (condition.kind === "stale-source") return { ...evaluateStaleSource(condition, current, now), observation: current };
  if (condition.kind === "observed-threshold-crossing") {
    const previous: WeatherObservation = {
      ...current,
      observationId: `previous:${current.observationId}`,
      observedAt: alert.lastCheckedAt ?? current.observedAt,
      value: alert.lastCheckedPrice ?? current.value,
    };
    return { ...evaluateObservedThresholdCrossing(condition, previous, current, now), observation: current };
  }
  if (condition.kind === "preliminary-to-final") {
    const previous: WeatherObservation = { ...current, status: alert.lastWeatherStatus };
    return { ...evaluatePreliminaryToFinal(condition, previous, current, now), observation: current };
  }
  if (condition.kind === "source-discrepancy") {
    const prints = await fetchNwsCliHistory(alert.weather.stationId, 2);
    const station = findWeatherStation(alert.weather.stationId);
    const date = zonedDateKey(station?.timezone ?? "UTC", now);
    const print = prints.find((item) => item.date === date);
    const value = print && (condition.metric === "high" ? print.highF : condition.metric === "low" ? print.lowF : print.precipIn);
    if (value == null) return null;
    return { ...evaluateSourceDiscrepancy(condition, [current, {
      sourceId: "nws-cli",
      observationId: print.productId ?? `${print.icao}:${print.date}`,
      observedAt: current.observedAt,
      metric: condition.metric,
      value,
      status: print.printKind === "final" ? "final" : "preliminary",
    }], now), observation: current };
  }
  return null;
}
