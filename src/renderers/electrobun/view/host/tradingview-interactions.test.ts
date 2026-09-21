import { describe, expect, test } from "bun:test";
import {
  classifyWheelGesture,
  panVisibleTimeRange,
  sameVisibleTimeRange,
  scaleVisibleTimeRange,
  visibleRangeInteraction,
  wheelDeltaPixels,
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
    // A trackpad fires many of these per swipe, so one event must stay gentle.
    expect(huge).toBeLessThan(1.2);
  });

  test("pans by a damped fraction of the visible span", () => {
    expect(panVisibleTimeRange(RANGE, 0.1)).toEqual({ start: 1_100_000, end: 2_100_000 });
    expect(wheelPanRatioFromDelta(50, 200)).toBeLessThan(0.05);
    expect(wheelPanRatioFromDelta(50, 200)).toBeGreaterThan(0);
    expect(wheelPanRatioFromDelta(-50, 200)).toBe(-wheelPanRatioFromDelta(50, 200));
    expect(wheelPanRatioFromDelta(50, 0)).toBe(0);
  });

  test("locks a swipe to pan or zoom so diagonal trackpad events cannot flip", () => {
    expect(classifyWheelGesture({ deltaX: 40, deltaY: 4 })).toBe("pan");
    expect(classifyWheelGesture({ deltaX: 4, deltaY: 40 })).toBe("zoom");
    expect(classifyWheelGesture({ deltaX: 30, deltaY: 40 }, "pan")).toBe("pan");
    expect(classifyWheelGesture({ deltaX: 40, deltaY: 4, ctrlKey: true })).toBe("zoom");
  });

  test("converts line-mode wheel deltas into pixels", () => {
    expect(wheelDeltaPixels(2, 1, 400)).toBe(32);
    expect(wheelDeltaPixels(1, 2, 400)).toBe(400);
    expect(wheelDeltaPixels(20, 0, 400)).toBe(20);
  });

  test("treats nearby time ranges as the same so parent echoes cannot fight a pan", () => {
    expect(sameVisibleTimeRange(
      { start: 1_000_000, end: 2_000_000 },
      { start: 1_000_400, end: 2_000_400 },
    )).toBe(true);
    expect(sameVisibleTimeRange(
      { start: 1_000_000, end: 2_000_000 },
      { start: 1_010_000, end: 2_010_000 },
    )).toBe(true);
    expect(sameVisibleTimeRange(
      { start: 1_000_000, end: 2_000_000 },
      { start: 1_200_000, end: 2_200_000 },
    )).toBe(false);
  });

  test("classifies a span-preserving shift as pan and a span change as zoom", () => {
    expect(visibleRangeInteraction(
      { start: 1_000_000, end: 2_000_000 },
      { start: 1_200_000, end: 2_200_000 },
    )).toBe("pan");
    expect(visibleRangeInteraction(
      { start: 1_000_000, end: 2_000_000 },
      { start: 1_250_000, end: 1_750_000 },
    )).toBe("zoom");
    expect(visibleRangeInteraction(null, RANGE)).toBe("zoom");
  });
});
