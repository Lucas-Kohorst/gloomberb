import { describe, expect, test } from "bun:test";
import {
  panVisibleTimeRange,
  scaleVisibleTimeRange,
  wheelPanRatioFromDelta,
  wheelZoomFactorFromDelta,
} from "./tradingview-interactions";

const RANGE = { start: 1_000_000, end: 2_000_000 };

describe("tradingview trackpad interactions", () => {
  test("zooms in around the right edge so the latest bar stays put", () => {
    const next = scaleVisibleTimeRange(RANGE, 2, 1);
    expect(next.end).toBe(RANGE.end);
    expect(next.end - next.start).toBe((RANGE.end - RANGE.start) / 2);
  });

  test("zooms in around the pointer instead of the midpoint", () => {
    const next = scaleVisibleTimeRange(RANGE, 2, 0.25);
    expect(next.start).toBe(1_125_000);
    expect(next.end).toBe(1_625_000);
  });

  test("treats wheel-up as zoom in and wheel-down as zoom out", () => {
    expect(wheelZoomFactorFromDelta(-8)).toBeGreaterThan(1);
    expect(wheelZoomFactorFromDelta(8)).toBeLessThan(1);
    expect(wheelZoomFactorFromDelta(0)).toBe(1);
  });

  test("caps a large pixel-delta burst so one tick cannot empty the window", () => {
    const huge = wheelZoomFactorFromDelta(-10_000);
    const capped = wheelZoomFactorFromDelta(-48);
    expect(huge).toBe(capped);
    expect(huge).toBeLessThan(2);
  });

  test("pans by a fraction of the visible span", () => {
    expect(panVisibleTimeRange(RANGE, 0.1)).toEqual({ start: 1_100_000, end: 2_100_000 });
    expect(wheelPanRatioFromDelta(50, 200)).toBe(0.25);
    expect(wheelPanRatioFromDelta(50, 0)).toBe(0);
  });
});
