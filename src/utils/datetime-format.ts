import { toTimestampMillis } from "./timestamp";

export type DisplayDateValue = Date | string | number | null | undefined;

export function parseDisplayDate(value: DisplayDateValue): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Age for a narrow column. Same token as `formatApproximateAge`. `fallback` when the value does not parse. */
export function formatRelativeTime(value: DisplayDateValue, now = Date.now(), fallback = "-"): string {
  const date = parseDisplayDate(value);
  if (!date) return fallback;
  return formatApproximateAge(date.getTime(), now);
}

/** Age of an epoch-ms timestamp. Same token as `formatApproximateAge`. `empty` when unset. */
export function formatRelativeAge(timestamp: number | undefined, now = Date.now(), empty = "never"): string {
  if (!timestamp) return empty;
  return formatApproximateAge(timestamp, now);
}

function formatStatusDay(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Status age and nothing else: `~0m` under a minute, `~5m`, `~1hr`, and the
 * local calendar day `YYYY-MM-DD` once the age reaches 24 hours. A missing or
 * future time clamps to `~0m`.
 */
export function formatApproximateAge(timestamp: number | null | undefined, now = Date.now()): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "~0m";
  const elapsed = now - timestamp;
  if (!(elapsed >= 60_000)) return "~0m";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `~${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `~${hours}hr`;
  return formatStatusDay(timestamp);
}

/**
 * The age token when `timestamp` is a real observation. A missing, zero, or
 * far-future time returns null so a pane does not invent `~0m`.
 */
export function formatObservationAge(timestamp: number | string | null | undefined, now = Date.now()): string | null {
  // A named calendar day has no clock. Printing it avoids a UTC-midnight shift into the previous local day.
  if (typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  const parsed = typeof timestamp === "number" ? timestamp : typeof timestamp === "string" && timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > now + 60_000) return null;
  return formatApproximateAge(parsed, now);
}

/**
 * Age of a feed or chat timestamp. Same token as `formatApproximateAge`.
 * `short` is accepted so existing callers keep compiling.
 */
export function formatTimeAgo(date: Date | string, _options: { short?: boolean } = {}): string {
  const ts = toTimestampMillis(date);
  if (Number.isNaN(ts)) return "unknown";
  return formatApproximateAge(ts);
}

export interface ShortDateOptions {
  /** "Jan 5, 2026" (the default), "Jan 5, 26", or no year at all ("Jan 5"). */
  year?: "numeric" | "2-digit" | false;
  /** "2-digit" pads the day so dates line up in a column ("Jan 05"). */
  day?: "numeric" | "2-digit";
  /** Read the day in UTC, for date-only values that name a calendar day rather than an instant. */
  utc?: boolean;
  /** Shown when the value is missing or does not parse. */
  fallback?: string;
}

const shortDateFormatters = new Map<string, Intl.DateTimeFormat>();

/** A month-name date such as "Jan 5, 2026", in local time unless `utc` is set. */
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

const clockFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekdayClockFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localMidnight(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * When a feed item was published, in local time, as a newswire prints it:
 * the time today ("14:32"), the weekday and time over the six days before
 * ("Mon 09:10"), and the date for anything older ("Sep 18", or "Sep 18, 25"
 * in another year). A weekday never names a day a week or more back.
 */
export function formatFeedTime(value: DisplayDateValue, now = Date.now(), fallback = "-"): string {
  const date = parseDisplayDate(value);
  if (!date) return fallback;
  const today = new Date(now);
  // Rounded, since a day with a DST change is 23 or 25 hours long.
  const daysAgo = Math.round((localMidnight(today) - localMidnight(date)) / 86_400_000);
  if (daysAgo === 0) return clockFormatter.format(date);
  if (daysAgo > 0 && daysAgo < 7) return weekdayClockFormatter.format(date).replace(",", "");
  return formatShortDate(date, { year: date.getFullYear() === today.getFullYear() ? false : "2-digit" });
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
