import type { PricePoint } from "../../../../types/financials";

export interface ReturnRow {
  key: string;
  timestamp: number;
  price: number;
  intervalChange: number | null;
  intervalPercent: number | null;
  cumulativeChange: number;
  cumulativePercent: number | null;
}

function pointTime(point: PricePoint): number | null {
  const value = point.date instanceof Date ? point.date.getTime() : new Date(point.date).getTime();
  return Number.isFinite(value) ? value : null;
}

export function filterPricePointsByWindow(points: readonly PricePoint[], start: number, end: number): PricePoint[] {
  return points
    .filter((point) => {
      const timestamp = pointTime(point);
      return timestamp !== null && timestamp >= start && timestamp <= end && Number.isFinite(point.close);
    })
    .sort((left, right) => pointTime(left)! - pointTime(right)!);
}

export function buildReturnRows(points: readonly PricePoint[], visibleFrom?: number): ReturnRow[] {
  const sorted = [...points]
    .filter((point) => pointTime(point) !== null && Number.isFinite(point.close))
    .sort((left, right) => pointTime(left)! - pointTime(right)!);
  const cumulativeFromIndex = visibleFrom === undefined
    ? 0
    : sorted.findIndex((point) => pointTime(point)! >= visibleFrom);
  if (cumulativeFromIndex < 0) return [];
  const first = sorted[cumulativeFromIndex]?.close;
  if (first === undefined) return [];

  return sorted.flatMap((point, index) => {
    const timestamp = pointTime(point)!;
    if (visibleFrom !== undefined && timestamp < visibleFrom) return [];
    const previous = sorted[index - 1]?.close;
    const intervalChange = previous === undefined ? null : point.close - previous;
    const cumulativeChange = point.close - first;
    return [{
      key: `${timestamp}:${index}`,
      timestamp,
      price: point.close,
      intervalChange,
      intervalPercent: previous === undefined || previous === 0 ? null : intervalChange! / previous,
      cumulativeChange,
      cumulativePercent: first === 0 ? null : cumulativeChange / first,
    }];
  }).reverse();
}
