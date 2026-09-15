import { settlementDateKey, settlementWindow, type DayWindowKind } from "./day-window";
import type { IemHourlyPoint } from "./iem-asos";

export interface AnalogDay {
  date: string;
  rmse: number;
  hoursCompared: number;
  analogHigh: number | null;
  remainingHigh: number | null;
}

function hourOfDay(utcMs: number, timeZone: string, kind: DayWindowKind): number {
  const dateKey = settlementDateKey({ utcMs, timeZone, kind });
  const window = settlementWindow({ dateKey, timeZone, kind });
  const hour = Math.floor((utcMs - window.startMs) / 3_600_000);
  if (hour < 0) return 0;
  if (hour > 23) return 23;
  return hour;
}

/**
 * Compare today's hourly temps to previous settlement days.
 * `hoursCompared` is how far into today we have data; analog remaining-high
 * is the rest of that analog day after the same hour.
 */
export function findAnalogDays(args: {
  points: readonly IemHourlyPoint[];
  todayKey: string;
  timeZone: string;
  kind: DayWindowKind;
  limit?: number;
}): AnalogDay[] {
  const byDate = new Map<string, number[]>();
  const highs = new Map<string, number>();
  for (const point of args.points) {
    if (point.tempF == null) continue;
    const date = settlementDateKey({ utcMs: point.validMs, timeZone: args.timeZone, kind: args.kind });
    const hour = hourOfDay(point.validMs, args.timeZone, args.kind);
    const hours = byDate.get(date) ?? Array.from({ length: 24 }, () => Number.NaN);
    const previous = hours[hour];
    hours[hour] = previous == null || Number.isNaN(previous) ? point.tempF : Math.max(previous, point.tempF);
    byDate.set(date, hours);
    const high = highs.get(date);
    highs.set(date, high == null ? point.tempF : Math.max(high, point.tempF));
  }
  const today = byDate.get(args.todayKey);
  if (!today) return [];
  const comparedHours = today
    .map((value, hour) => Number.isFinite(value) ? hour : -1)
    .filter((hour) => hour >= 0);
  if (comparedHours.length < 3) return [];

  const results: AnalogDay[] = [];
  for (const [date, hours] of byDate) {
    if (date === args.todayKey) continue;
    let sum = 0;
    let count = 0;
    for (const hour of comparedHours) {
      const analog = hours[hour];
      const live = today[hour];
      if (analog == null || live == null || !Number.isFinite(analog) || !Number.isFinite(live)) continue;
      const delta = analog - live;
      sum += delta * delta;
      count += 1;
    }
    if (count < 3) continue;
    const lastHour = comparedHours[comparedHours.length - 1]!;
    let remaining: number | null = null;
    for (let hour = lastHour + 1; hour < 24; hour += 1) {
      const value = hours[hour];
      if (value == null || !Number.isFinite(value)) continue;
      remaining = remaining == null ? value : Math.max(remaining, value);
    }
    results.push({
      date,
      rmse: Math.sqrt(sum / count),
      hoursCompared: count,
      analogHigh: highs.get(date) ?? null,
      remainingHigh: remaining,
    });
  }
  return results.sort((left, right) => left.rmse - right.rmse).slice(0, args.limit ?? 8);
}
