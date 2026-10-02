import { canonicalExchange } from "../../../utils/exchanges";

const NYSE_VENUES = new Set(["NYSE", "AMEX", "ARCA", "NYSE NATIONAL", "NYSE CHICAGO", "NYSE TEXAS", "BATS", "CBOE"]);
const CLOSURES: Record<number, readonly string[]> = {
  2025: ["01-01", "01-09", "01-20", "02-17", "04-18", "05-26", "06-19", "07-04", "09-01", "11-27", "12-25"],
  2026: ["01-01", "01-19", "02-16", "04-03", "05-25", "06-19", "07-03", "09-07", "11-26", "12-25"],
  2027: ["01-01", "01-18", "02-15", "03-26", "05-31", "06-18", "07-05", "09-06", "11-25", "12-24"],
  2028: ["01-17", "02-21", "04-14", "05-29", "06-19", "07-04", "09-04", "11-23", "12-25"],
};
const YEARS = [2025, 2026, 2027, 2028] as const;

/** Published full closures for NYSE venues and Nasdaq, 2025–2028. Early closes stay sessions. */
export function getPublishedUsEquityCalendarYears(exchange: string): readonly number[] | null {
  const venue = canonicalExchange(exchange);
  return venue === "NASDAQ" || NYSE_VENUES.has(venue) ? YEARS : null;
}

function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? new Date(time) : null;
}

export function getPublishedUsEquityCalendarDay(exchange: string, date: string): "session" | "closed" | null {
  const day = calendarDate(date);
  if (!day || !getPublishedUsEquityCalendarYears(exchange)?.includes(day.getUTCFullYear())) return null;
  const weekday = day.getUTCDay();
  return weekday === 0 || weekday === 6 || CLOSURES[day.getUTCFullYear()]!.includes(date.slice(5)) ? "closed" : "session";
}
