export type WxBookMetric = "high";

export interface LocalClock {
  hour: number;
  minute: number;
}

export const DEFAULT_WX_BOOK_CUTOFF: LocalClock = { hour: 11, minute: 0 };

/** Format a `LocalClock` as `HH:MM` (24-hour, zero-padded). */
export function formatClock(clock: LocalClock): string {
  return `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}

export type StrikeInterval =
  | { kind: "less"; cap: number }
  | { kind: "greater"; floor: number }
  | { kind: "between"; floor: number; cap: number };

export interface StrikeBucket {
  ticker: string;
  label: string;
  interval: StrikeInterval;
  midpointF: number | null;
  result: "yes" | "no" | "void" | null;
}

export interface StrikeYesPoint {
  /** Candle end time, unix seconds. */
  t: number;
  /** Yes dollars in 0..1. */
  yes: number;
}

export interface KalshiStrikeBookSeries {
  stationId: string;
  seriesTicker: string;
  eventTicker: string;
  date: string;
  metric: WxBookMetric;
  strikes: readonly StrikeBucket[];
  paths: readonly (readonly StrikeYesPoint[])[];
  settlementF: number | null;
  candleSource: "live" | "historical";
  fetchedAt: number;
}

export interface NwsPrintPoint {
  t: number;
  tempF: number;
  source: "nws-asos" | "iem-metar";
}

export interface NwsPrintSeries {
  stationId: string;
  icao: string;
  date: string;
  points: readonly NwsPrintPoint[];
  dayHighF: number | null;
  coverage: "asos-5min" | "metar-hourly" | "empty";
  fetchedAt: number;
}

export interface FavoriteStrike {
  bucket: StrikeBucket;
  yesPrice: number;
  midpointF: number;
  pricedAtSec: number;
}

export interface WxBookDayQuery {
  stationId: string;
  date: string;
  cutoff?: LocalClock;
  metric?: WxBookMetric;
  includePrints?: boolean;
}

export interface WxBookQuery {
  stationId: string;
  from: string;
  to: string;
  cutoff?: LocalClock;
  metric?: WxBookMetric;
}

export type WxBookLoadStatus = "loading" | "partial" | "ready" | "error";

export interface WxBookDayView {
  stationId: string;
  date: string;
  timeZone: string;
  cutoff: LocalClock;
  cutoffUtcMs: number;
  favorite: FavoriteStrike | null;
  book: KalshiStrikeBookSeries | null;
  asos: NwsPrintSeries;
  settlementF: number | null;
  runningHighAtCutoffF: number | null;
  hit: boolean | null;
  status: WxBookLoadStatus;
  errorMessage: string | null;
}

export interface WxBookDayRow {
  date: string;
  favoriteLabel: string | null;
  favoriteMidpoint: number | null;
  favoriteYes: number | null;
  asosHighF: number | null;
  settlementF: number | null;
  hit: boolean | null;
  bookAvailable: boolean;
}

export interface WxBookRangeView {
  stationId: string;
  from: string;
  to: string;
  cutoff: LocalClock;
  rows: readonly WxBookDayRow[];
  samples: number;
  hitRate: number | null;
  pearson: number | null;
  skipped: number;
  status: WxBookLoadStatus;
  errorMessage: string | null;
}
