import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import { displayWidth, formatPercentRaw } from "../../../utils/format";
import { truncateWithEllipsis } from "../../../utils/text-wrap";
import { formatChartLegendValue, formatChartVolume } from "./format";

/** Gap between the label and the first token, and between later tokens. */
const LABEL_GAP = " ";
const TOKEN_GAP = "  ";

export type PriceStripDirection = "up" | "down" | "flat";

export interface PriceStripToken {
  text: string;
  /** Higher ranks are dropped first when a legend row cannot fit every token. */
  rank: number;
  direction?: PriceStripDirection;
}

/**
 * Drop order under pressure. Core tokens never drop, so a tight row keeps the
 * last print and the move and ellipsizes the name instead.
 */
export const PRICE_STRIP_RANK = {
  core: 0,
  /** Window high / low. */
  range: 1,
  /** Open, high, and low around the close. */
  ohlc: 2,
  volume: 3,
} as const;

export interface PriceStrip {
  label: string;
  tokens: PriceStripToken[];
}

export interface PriceStripLayout {
  /** Label, ellipsized to the budget when the numbers needed the room. */
  label: string;
  tokens: PriceStripToken[];
}

export interface BuildPriceStripOptions {
  series: ResolvedSeries;
  /** Crosshair point: swaps the print (and the OHLC) to the hovered bar. */
  cursorPoint?: TimeSeriesPoint | null;
  cursorValue?: number | null;
  /** Visible window; window high, low, and the move baseline come from it. */
  startTime?: number;
  endTime?: number;
  formatValue?: (value: number, series: ResolvedSeries) => string;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function directionOf(value: number): PriceStripDirection {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function visiblePoints(
  points: TimeSeriesPoint[],
  startTime: number | undefined,
  endTime: number | undefined,
): TimeSeriesPoint[] {
  if (startTime === undefined || endTime === undefined) return points;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return points;
  const inWindow = points.filter((point) => {
    const time = point.date.getTime();
    return time >= startTime && time <= endTime;
  });
  return inWindow.length > 0 ? inWindow : points;
}

function pointValue(point: TimeSeriesPoint | null | undefined): number | null {
  return finite(point?.close) ?? finite(point?.value);
}

function windowExtreme(
  points: readonly TimeSeriesPoint[],
  side: "high" | "low",
): number | null {
  let extreme: number | null = null;
  for (const point of points) {
    const value = finite(point[side]) ?? finite(point.close) ?? finite(point.value);
    if (value === null) continue;
    if (extreme === null || (side === "high" ? value > extreme : value < extreme)) {
      extreme = value;
    }
  }
  return extreme;
}

/**
 * A Bloomberg-style readout for one legend row: the last print, the move, and
 * the window extremes (or the bar's OHLC). The change compares the quote's
 * previous close when the series carries one, otherwise the first visible
 * point, so a range change always matches the range on screen.
 */
export function buildPriceStrip(options: BuildPriceStripOptions): PriceStrip {
  const { series } = options;
  const format = (value: number) => options.formatValue
    ? options.formatValue(value, series)
    : formatChartLegendValue(value, series.unit, series.unitGroup);

  const visible = visiblePoints(series.points, options.startTime, options.endTime);
  const rest = visible.at(-1) ?? null;
  const cursor = options.cursorPoint ?? null;
  const bar = cursor ?? rest;
  const restValue = pointValue(rest);
  const shown = cursor
    ? finite(options.cursorValue) ?? pointValue(cursor) ?? restValue
    : restValue;

  const tokens: PriceStripToken[] = [];
  const open = finite(bar?.open);
  const high = finite(bar?.high);
  const low = finite(bar?.low);
  const close = pointValue(bar);
  const isOhlcBar = open !== null && high !== null && low !== null && close !== null;

  if (isOhlcBar) {
    tokens.push({ text: `O ${format(open!)}`, rank: PRICE_STRIP_RANK.ohlc });
    tokens.push({ text: `H ${format(high!)}`, rank: PRICE_STRIP_RANK.ohlc });
    tokens.push({ text: `L ${format(low!)}`, rank: PRICE_STRIP_RANK.ohlc });
    tokens.push({ text: `C ${format(shown ?? close!)}`, rank: PRICE_STRIP_RANK.core });
  } else {
    tokens.push({ text: shown !== null ? format(shown) : "—", rank: PRICE_STRIP_RANK.core });
  }

  const pushMove = (delta: number, magnitude: string) => {
    tokens.push({
      text: delta === 0 ? magnitude : `${delta > 0 ? "+" : "-"}${magnitude}`,
      rank: PRICE_STRIP_RANK.core,
      direction: directionOf(delta),
    });
  };

  const quoteChange = finite(series.latestChange);
  const previousClose = finite(series.previousClose);
  const quotePercent = finite(series.latestChangePercent)
    ?? (quoteChange !== null && previousClose !== null && previousClose !== 0
      ? (quoteChange / Math.abs(previousClose)) * 100
      : null);
  if (quoteChange !== null || quotePercent !== null) {
    if (quoteChange !== null) pushMove(quoteChange, format(Math.abs(quoteChange)));
    if (quotePercent !== null) {
      tokens.push({
        text: formatPercentRaw(quotePercent),
        rank: PRICE_STRIP_RANK.core,
        direction: directionOf(quotePercent),
      });
    }
  } else {
    const baseline = pointValue(visible[0]);
    if (shown !== null && baseline !== null && visible.length > 1) {
      const delta = shown - baseline;
      pushMove(delta, format(Math.abs(delta)));
      if (baseline !== 0) {
        const percent = (delta / Math.abs(baseline)) * 100;
        tokens.push({
          text: formatPercentRaw(percent),
          rank: PRICE_STRIP_RANK.core,
          direction: directionOf(percent),
        });
      }
    }
  }

  // A bar already prints its own high and low; a scalar print does not.
  if (!isOhlcBar && visible.length > 1) {
    const windowHigh = windowExtreme(visible, "high");
    const windowLow = windowExtreme(visible, "low");
    if (windowHigh !== null) {
      tokens.push({ text: `H ${format(windowHigh)}`, rank: PRICE_STRIP_RANK.range });
    }
    if (windowLow !== null) {
      tokens.push({ text: `L ${format(windowLow)}`, rank: PRICE_STRIP_RANK.range });
    }
  }

  const volume = finite(bar?.volume);
  if (volume !== null && volume >= 0) {
    tokens.push({ text: `V ${formatChartVolume(volume)}`, rank: PRICE_STRIP_RANK.volume });
  }

  return { label: series.label, tokens };
}

/** Cells a label plus its tokens occupy on one legend row. */
export function priceStripWidth(
  label: string,
  tokens: readonly PriceStripToken[],
): number {
  if (tokens.length === 0) return displayWidth(label);
  return displayWidth(label)
    + LABEL_GAP.length
    + tokens.reduce((total, token) => total + displayWidth(token.text), 0)
    + TOKEN_GAP.length * (tokens.length - 1);
}

export interface PriceStripSegment {
  text: string;
  kind: "label" | "token";
  direction?: PriceStripDirection;
}

/**
 * Display-order runs of the fitted strip, each carrying the separator that
 * precedes it, so a renderer can color the move without re-deriving spacing.
 */
export function priceStripSegments(layout: PriceStripLayout): PriceStripSegment[] {
  const segments: PriceStripSegment[] = [{ text: layout.label, kind: "label" }];
  layout.tokens.forEach((token, index) => {
    segments.push({
      text: `${index === 0 ? LABEL_GAP : TOKEN_GAP}${token.text}`,
      kind: "token",
      direction: token.direction,
    });
  });
  return segments;
}

/** The rendered line for a fitted strip, in display order. */
export function priceStripText(layout: PriceStripLayout): string {
  return priceStripSegments(layout).map((segment) => segment.text).join("");
}

/**
 * Drops tokens from the lowest-value end and then ellipsizes the label so the
 * numbers are never the part that gets clipped.
 */
export function fitPriceStrip(strip: PriceStrip, budget: number): PriceStripLayout {
  let tokens = [...strip.tokens];
  while (tokens.length > 0 && priceStripWidth(strip.label, tokens) > budget) {
    const lowestWanted = Math.max(...tokens.map((token) => token.rank));
    if (lowestWanted <= PRICE_STRIP_RANK.core) break;
    tokens = tokens.filter((token) => token.rank !== lowestWanted);
  }
  if (priceStripWidth(strip.label, tokens) <= budget) return { label: strip.label, tokens };

  const numericWidth = tokens.length === 0
    ? 0
    : LABEL_GAP.length
      + tokens.reduce((total, token) => total + displayWidth(token.text), 0)
      + TOKEN_GAP.length * (tokens.length - 1);
  return { label: truncateWithEllipsis(strip.label, Math.max(1, budget - numericWidth)), tokens };
}
