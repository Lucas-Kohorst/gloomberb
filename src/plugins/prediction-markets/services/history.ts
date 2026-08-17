import type { PredictionHistoryPoint } from "../types";

/** Cached history round-trips through JSON, so `date` comes back as a string. */
export function coercePredictionPointDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const next = new Date(value);
    return Number.isFinite(next.getTime()) ? next : null;
  }
  return null;
}

export function revivePredictionHistoryPoints(
  points: readonly PredictionHistoryPoint[],
): PredictionHistoryPoint[] {
  return points.flatMap((point) => {
    const date = coercePredictionPointDate(point.date);
    if (!date) return [];
    return point.date instanceof Date ? [point] : [{ ...point, date }];
  });
}
