import type { DegreeDayReading, WeatherObservation } from "./types";

const BASE_TEMP_F = 65;

/** Compute daily HDD and CDD from high/low temperatures. */
export function computeDailyDegreeDays(
  highF: number,
  lowF: number,
): { hdd: number; cdd: number } {
  const avgF = (highF + lowF) / 2;
  const hdd = Math.max(0, BASE_TEMP_F - avgF);
  const cdd = Math.max(0, avgF - BASE_TEMP_F);
  return { hdd: Math.round(hdd * 100) / 100, cdd: Math.round(cdd * 100) / 100 };
}

/**
 * From a list of weather observations for a station on a given day,
 * compute the daily degree-day values and running monthly cumulative.
 * Observations should be for the local day (midnight to midnight).
 */
export function computeRunningDegreeDays(
  observations: readonly WeatherObservation[],
  stationId: string,
  date: string,  // YYYY-MM-DD
  allMonthObservations: readonly WeatherObservation[] = [],
): DegreeDayReading {
  // Find the day's high and low from NWS observations
  const dayObs = observations.filter(
    (obs) => obs.stationId === stationId && obs.source === "nws-observations",
  );
  
  let highF: number | null = null;
  let lowF: number | null = null;
  
  for (const obs of dayObs) {
    if (obs.tempF == null) continue;
    if (highF == null || obs.tempF > highF) highF = obs.tempF;
    if (lowF == null || obs.tempF < lowF) lowF = obs.tempF;
  }
  
  const avgF = highF != null && lowF != null ? (highF + lowF) / 2 : null;
  const { hdd, cdd } = avgF != null
    ? computeDailyDegreeDays(highF!, lowF!)
    : { hdd: 0, cdd: 0 };
  
  // Compute monthly cumulative from all month observations
  const monthPrefix = date.slice(0, 7); // YYYY-MM
  const monthDayValues = new Map<string, { hdd: number; cdd: number }>();
  
  for (const obs of allMonthObservations) {
    if (obs.stationId !== stationId || obs.source !== "nws-observations") continue;
    const obsDate = new Date(obs.timestamp).toISOString().slice(0, 10);
    if (!obsDate.startsWith(monthPrefix)) continue;
    // We don't have per-observation high/low here; the caller should
    // provide pre-computed daily degree-day readings for the month.
  }
  
  // For now, return just today's values. The polling hook will
  // maintain the monthly cumulative by accumulating daily readings.
  return {
    date,
    stationId,
    highF,
    lowF,
    avgF,
    hdd,
    cdd,
    monthlyCumulativeHdd: hdd,  // caller accumulates
    monthlyCumulativeCdd: cdd,  // caller accumulates
    dayCount: highF != null && lowF != null ? 1 : 0,
  };
}

/**
 * Aggregate pre-computed daily degree-day readings into monthly totals.
 */
export function aggregateMonthlyDegreeDays(
  dailyReadings: readonly DegreeDayReading[],
): { monthlyHdd: number; monthlyCdd: number; dayCount: number } {
  let monthlyHdd = 0;
  let monthlyCdd = 0;
  let dayCount = 0;
  
  for (const reading of dailyReadings) {
    if (reading.highF == null || reading.lowF == null) continue;
    monthlyHdd += reading.hdd;
    monthlyCdd += reading.cdd;
    dayCount += 1;
  }
  
  return {
    monthlyHdd: Math.round(monthlyHdd * 100) / 100,
    monthlyCdd: Math.round(monthlyCdd * 100) / 100,
    dayCount,
  };
}
