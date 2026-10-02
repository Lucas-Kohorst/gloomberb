import { canonicalExchange } from "../../../utils/exchanges";
import { getPublishedUsEquityCalendarDay, getPublishedUsEquityCalendarYears } from "./sessions";

const DAY_MS = 86_400_000;

function dateTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

function isSession(time: number, exchange: string): boolean {
  return getPublishedUsEquityCalendarDay(exchange, new Date(time).toISOString().slice(0, 10)) === "session";
}

/** Friday's published close, or the session before it when that Friday is closed. */
export function publishedWeekClose(friday: string, venue: string): string | null {
  const time = dateTimestamp(friday);
  if (time == null || new Date(time).getUTCDay() !== 5) return null;
  const exchange = canonicalExchange(venue);
  const years = getPublishedUsEquityCalendarYears(exchange) ?? [];
  for (let offset = 0; offset < 5; offset++) {
    const candidate = time - offset * DAY_MS;
    if (!years.includes(new Date(candidate).getUTCFullYear())) return null;
    if (isSession(candidate, exchange)) return new Date(candidate).toISOString().slice(0, 10);
  }
  return null;
}
