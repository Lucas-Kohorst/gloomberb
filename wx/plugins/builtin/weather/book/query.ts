import { zonedLocalClockUtcMs } from "../../../../../src/plugins/builtin/weather/mapping";
import { mapPool } from "../../../../../src/plugins/builtin/weather/kalshi-forecast";
import {
  canonicalWeatherStationId,
  findWeatherStation,
} from "../../../../../src/plugins/builtin/weather/stations";
import { loadKalshiStrikeBookSeries } from "./kalshi";
import { loadNwsPrintSeries } from "./prints";
import { runningMaxAtCutoff, summarizeBookRows } from "./stats";
import { favoriteContainsSettlement, favoriteStrikeAtCutoff } from "./strikes";
import {
  DEFAULT_WX_BOOK_CUTOFF,
  type WxBookDayQuery,
  type WxBookDayRow,
  type WxBookDayView,
  type WxBookQuery,
  type WxBookRangeView,
} from "./types";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function addUtcDays(dateKey: string, days: number): string {
  const match = DATE_RE.exec(dateKey);
  if (!match) return dateKey;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

function eachDate(from: string, to: string): string[] {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return [];
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addUtcDays(cursor, 1);
    if (dates.length > 62) break;
  }
  return dates;
}

function emptyPrints(stationId: string, date: string, icao: string, now: number) {
  return {
    stationId,
    icao,
    date,
    points: [],
    dayHighF: null,
    coverage: "empty" as const,
    fetchedAt: now,
  };
}

function projectRow(view: WxBookDayView): WxBookDayRow {
  return {
    date: view.date,
    favoriteLabel: view.favorite?.bucket.label ?? null,
    favoriteMidpoint: view.favorite?.midpointF ?? null,
    favoriteYes: view.favorite?.yesPrice ?? null,
    asosHighF: view.asos.dayHighF,
    settlementF: view.settlementF,
    hit: view.hit,
    bookAvailable: view.book != null,
  };
}

export async function queryWxBookDay(query: WxBookDayQuery, now = Date.now()): Promise<WxBookDayView> {
  const stationId = canonicalWeatherStationId(query.stationId) ?? query.stationId.trim().toUpperCase();
  const station = findWeatherStation(stationId);
  const timeZone = station?.timezone ?? "UTC";
  const cutoff = query.cutoff ?? DEFAULT_WX_BOOK_CUTOFF;
  const cutoffUtcMs = zonedLocalClockUtcMs(query.date, timeZone, cutoff);
  const cutoffSec = Math.floor(cutoffUtcMs / 1000);
  const icao = station?.icao ?? `K${stationId}`;

  const [book, asos] = await Promise.all([
    loadKalshiStrikeBookSeries(stationId, query.date, now, query.metric ?? "high", {
      window: query.includePrints === false ? "cutoff" : "day",
      cutoffUtcMs,
    }),
    query.includePrints === false
      ? Promise.resolve(emptyPrints(stationId, query.date, icao, now))
      : loadNwsPrintSeries(stationId, query.date, now),
  ]);

  const favorite = book
    ? favoriteStrikeAtCutoff(book.strikes, book.paths, cutoffSec)
    : null;
  const settlementF = book?.settlementF ?? null;
  const hit = favorite && settlementF != null
    ? favoriteContainsSettlement(favorite, settlementF)
    : null;
  const printsSkipped = query.includePrints === false;
  const hasPrints = asos.points.length > 0;
  const missing = book == null && !hasPrints;
  const status = book && (printsSkipped || hasPrints)
    ? "ready"
    : book || hasPrints
      ? "partial"
      : "error";
  return {
    stationId,
    date: query.date,
    timeZone,
    cutoff,
    cutoffUtcMs,
    favorite,
    book,
    asos: hasPrints ? asos : emptyPrints(stationId, query.date, icao, now),
    settlementF,
    runningHighAtCutoffF: runningMaxAtCutoff(asos.points, cutoffUtcMs),
    hit,
    status,
    errorMessage: missing ? "No Kalshi book or NWS prints for this station-day." : null,
  };
}

export async function queryWxBookRange(query: WxBookQuery, now = Date.now()): Promise<WxBookRangeView> {
  const stationId = canonicalWeatherStationId(query.stationId) ?? query.stationId.trim().toUpperCase();
  const cutoff = query.cutoff ?? DEFAULT_WX_BOOK_CUTOFF;
  const dates = eachDate(query.from, query.to);
  const views = await mapPool(dates, 2, (date) => queryWxBookDay({
    stationId,
    date,
    cutoff,
    metric: query.metric,
    includePrints: false,
  }, now));
  const rows = views.map(projectRow);
  const summary = summarizeBookRows(rows);
  const failed = views.every((view) => view.status === "error");
  return {
    stationId,
    from: query.from,
    to: query.to,
    cutoff,
    rows,
    samples: summary.samples,
    hitRate: summary.hitRate,
    pearson: summary.pearson,
    skipped: summary.skipped,
    status: failed ? "error" : views.some((view) => view.status !== "ready") ? "partial" : "ready",
    errorMessage: failed ? "No book rows in this window." : null,
  };
}

export { DEFAULT_WX_BOOK_CUTOFF };
