/**
 * Trackpad zoom/pan for the TradingView host.
 *
 * lightweight-charts maps pinch to two TouchEvents. A Mac trackpad never
 * produces those: Chrome synthesizes ctrl+wheel, and WKWebView (Electrobun,
 * Safari) fires gesturestart/gesturechange. Owning wheel/gesture here is what
 * actually zooms the pane.
 */

export interface VisibleTimeRangeMs {
  start: number;
  end: number;
}

const MIN_SPAN_MS = 1_000;
const MAX_WHEEL_MAGNITUDE = 48;
const WHEEL_ZOOM_PER_PIXEL = 0.02;

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
  return deltaX / widthPx;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
