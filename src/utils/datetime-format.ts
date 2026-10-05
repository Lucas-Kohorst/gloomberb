export type DisplayDateValue = Date | string | number | null | undefined;

export { formatRelativeAge } from "./relative-time";

export function parseDisplayDate(value: DisplayDateValue): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface ShortDateOptions {
  year?: "numeric" | "2-digit" | false;
  day?: "numeric" | "2-digit";
  utc?: boolean;
  fallback?: string;
}

const shortDateFormatters = new Map<string, Intl.DateTimeFormat>();

/** A month-name date such as "Jan 5, 2026". */
export function formatShortDate(value: DisplayDateValue, options: ShortDateOptions = {}): string {
  const date = parseDisplayDate(value);
  if (!date) return options.fallback ?? "-";
  const { year = "numeric", day = "numeric", utc = false } = options;
  const key = `${year}:${day}:${utc}`;
  let formatter = shortDateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day,
      year: year || undefined,
      timeZone: utc ? "UTC" : undefined,
    });
    shortDateFormatters.set(key, formatter);
  }
  return formatter.format(date);
}

export function formatRelativeTime(value: DisplayDateValue, now = Date.now(), fallback = "-"): string {
  const date = parseDisplayDate(value);
  if (!date) return fallback;

  const ms = now - date.getTime();
  if (!Number.isFinite(ms)) return fallback;
  if (ms < 60_000) return "<1m";

  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;

  return `${Math.floor(hr / 24)}d`;
}

export function formatDetailDate(value: DisplayDateValue, fallback = "-"): string {
  const date = parseDisplayDate(value);
  if (!date) return fallback;

  const datePart = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} at ${timePart}`;
}

export function formatCalendarDate(value: DisplayDateValue, fallback = "-"): string {
  const date = parseDisplayDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
