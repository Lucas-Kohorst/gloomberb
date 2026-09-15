/**
 * Settlement-day windows for weather markets.
 *
 * `clock` is local midnight-to-midnight (Weather.gov, Weather Underground,
 * most Polymarket). `lst` is local standard time year-round (NWS CLI, Kalshi,
 * Polymarket US). During daylight saving that LST day starts at 1:00 AM clock.
 */

export type DayWindowKind = "clock" | "lst";

export interface SettlementWindow {
  dateKey: string;
  timeZone: string;
  kind: DayWindowKind;
  /** Inclusive start, epoch ms. */
  startMs: number;
  /** Exclusive end, epoch ms. */
  endMs: number;
}

function zonedWallTimeUtc(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    Number(parts.find((part) => part.type === type)?.value)
  );
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
}

/** Minutes east of UTC (CST = -360, CDT = -300). */
export function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  return (zonedWallTimeUtc(utcMs, timeZone) - utcMs) / 60_000;
}

/**
 * Standard (non-DST) offset for the zone in the year of `utcMs`.
 * DST moves clocks forward, so standard is the more-negative offset.
 */
export function standardOffsetMinutes(timeZone: string, utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const january = zoneOffsetMinutes(Date.UTC(year, 0, 15, 12, 0, 0), timeZone);
  const july = zoneOffsetMinutes(Date.UTC(year, 6, 15, 12, 0, 0), timeZone);
  return Math.min(january, july);
}

export function daylightDeltaMinutes(utcMs: number, timeZone: string): number {
  return zoneOffsetMinutes(utcMs, timeZone) - standardOffsetMinutes(timeZone, utcMs);
}

/** UTC ms of 00:00:00 clock time on `dateKey` in `timeZone`. */
export function zonedMidnightUtcMs(dateKey: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return Date.parse(`${dateKey}T00:00:00Z`);
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0);
  let utc = desired;
  for (let i = 0; i < 8; i += 1) {
    const delta = zonedWallTimeUtc(utc, timeZone) - desired;
    if (delta === 0) return utc;
    utc -= delta;
  }
  return utc;
}

function packedDateKey(packedUtcMs: number): string {
  const date = new Date(packedUtcMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local clock calendar date for `utcMs`. */
export function zonedDateKey(timeZone: string, utcMs = Date.now()): string {
  return packedDateKey(zonedWallTimeUtc(utcMs, timeZone));
}

export function addCalendarDays(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  return packedDateKey(utc);
}

/** Settlement calendar date for an instant. */
export function settlementDateKey(args: {
  utcMs: number;
  timeZone: string;
  kind: DayWindowKind;
}): string {
  const packedClock = zonedWallTimeUtc(args.utcMs, args.timeZone);
  if (args.kind === "clock") return packedDateKey(packedClock);
  const extra = daylightDeltaMinutes(args.utcMs, args.timeZone);
  return packedDateKey(packedClock - extra * 60_000);
}

export function settlementWindow(args: {
  dateKey: string;
  timeZone: string;
  kind: DayWindowKind;
}): SettlementWindow {
  const clockStart = zonedMidnightUtcMs(args.dateKey, args.timeZone);
  const nextKey = addCalendarDays(args.dateKey, 1);
  const clockEnd = zonedMidnightUtcMs(nextKey, args.timeZone);
  if (args.kind === "clock") {
    return {
      dateKey: args.dateKey,
      timeZone: args.timeZone,
      kind: args.kind,
      startMs: clockStart,
      endMs: clockEnd,
    };
  }
  const startMs = clockStart + daylightDeltaMinutes(clockStart, args.timeZone) * 60_000;
  const endMs = clockEnd + daylightDeltaMinutes(clockEnd, args.timeZone) * 60_000;
  return {
    dateKey: args.dateKey,
    timeZone: args.timeZone,
    kind: args.kind,
    startMs,
    endMs,
  };
}

export function inSettlementWindow(utcMs: number, window: SettlementWindow): boolean {
  return utcMs >= window.startMs && utcMs < window.endMs;
}

export function observationMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}
