/**
 * Trackpad zoom/pan for the TradingView host.
 *
 * lightweight-charts maps pinch to two TouchEvents. A Mac trackpad never
 * produces those: Chrome synthesizes ctrl+wheel, and WKWebView (Electrobun,
 * Safari) fires gesturestart/gesturechange. Owning wheel/gesture here is what
 * actually zooms the pane.
 */

import type { TrackpadGestureKind } from "../../../../ui/host";

export type { TrackpadGestureKind };

export interface VisibleTimeRangeMs {
  start: number;
  end: number;
}

const MIN_SPAN_MS = 1_000;
const MAX_WHEEL_MAGNITUDE = 48;
/**
 * A Mac trackpad emits many high-magnitude pixel deltas per physical swipe, so
 * per-event zoom and pan have to stay small or one flick crosses the whole range.
 */
const WHEEL_ZOOM_PER_PIXEL = 0.0022;
const WHEEL_PAN_DAMPING = 0.12;

export function scaleVisibleTimeRange(
  range: VisibleTimeRangeMs,
  zoomFactor: number,
  anchorRatio: number,
): VisibleTimeRangeMs {
  const span = range.end - range.start;
  if (!(span > 0) || !Number.isFinite(zoomFactor) || zoomFactor <= 0) return range;
  const nextSpan = Math.max(MIN_SPAN_MS, span / zoomFactor);
  const ratio = clamp(anchorRatio, 0, 1);
  const start = range.start + (span - nextSpan) * ratio;
  return { start, end: start + nextSpan };
}

export function panVisibleTimeRange(
  range: VisibleTimeRangeMs,
  shiftRatio: number,
): VisibleTimeRangeMs {
  const span = range.end - range.start;
  if (!(span > 0) || !Number.isFinite(shiftRatio) || shiftRatio === 0) return range;
  const shift = span * shiftRatio;
  return { start: range.start + shift, end: range.end + shift };
}

/**
 * Wheel-up / pinch-out (negative deltaY) zooms in. Magnitude is capped so a
 * pixel-delta trackpad burst cannot jump the window by an order of magnitude.
 */
export function wheelZoomFactorFromDelta(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const magnitude = Math.min(Math.max(Math.abs(deltaY), 1), MAX_WHEEL_MAGNITUDE);
  const factor = 1 + magnitude * WHEEL_ZOOM_PER_PIXEL;
  return deltaY < 0 ? factor : 1 / factor;
}

export function wheelPanRatioFromDelta(deltaX: number, widthPx: number): number {
  if (!Number.isFinite(deltaX) || deltaX === 0 || !(widthPx > 0)) return 0;
  return (deltaX / widthPx) * WHEEL_PAN_DAMPING;
}

const WHEEL_LINE_PX = 16;
const WHEEL_AXIS_LOCK_RATIO = 1.15;

/** Pixel-space deltas. Trackpads report pixels; some mice report lines/pages. */
export function wheelDeltaPixels(
  delta: number,
  deltaMode: number,
  pageSizePx: number,
): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * Math.max(pageSizePx, 1);
  return delta;
}

/**
 * Lock pan vs zoom for one trackpad swipe. Diagonal flicks otherwise flip
 * between the two every event and the window jumps.
 */
export function classifyWheelGesture(
  event: { deltaX: number; deltaY: number; ctrlKey?: boolean; metaKey?: boolean },
  locked: TrackpadGestureKind | null = null,
): TrackpadGestureKind | null {
  if (event.ctrlKey || event.metaKey) {
    return Number.isFinite(event.deltaY) && event.deltaY !== 0 ? "zoom" : locked;
  }
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  if (absX === 0 && absY === 0) return locked;
  if (locked) return locked;
  if (absX > absY * WHEEL_AXIS_LOCK_RATIO) return "pan";
  if (absY > absX * WHEEL_AXIS_LOCK_RATIO) return "zoom";
  return absX >= absY ? "pan" : "zoom";
}

export function sameVisibleTimeRange(
  left: VisibleTimeRangeMs,
  right: VisibleTimeRangeMs,
  toleranceMs = 1_000,
): boolean {
  const span = Math.max(left.end - left.start, right.end - right.start, 1);
  const tolerance = Math.max(toleranceMs, span * 0.02);
  return Math.abs(left.start - right.start) <= tolerance
    && Math.abs(left.end - right.end) <= tolerance;
}

/** Drag keeps the span; pinch/wheel-zoom changes it. */
export function visibleRangeInteraction(
  previous: VisibleTimeRangeMs | null,
  next: VisibleTimeRangeMs,
  toleranceMs = 1_000,
): TrackpadGestureKind {
  if (!previous) return "zoom";
  const previousSpan = previous.end - previous.start;
  const nextSpan = next.end - next.start;
  return Math.abs(nextSpan - previousSpan) <= toleranceMs ? "pan" : "zoom";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
