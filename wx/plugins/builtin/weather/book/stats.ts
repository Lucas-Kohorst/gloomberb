import type { WxBookDayRow } from "./types";

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return num / den;
}

export function runningMaxAtCutoff(
  points: readonly { t: number; tempF: number }[],
  cutoffMs: number,
): number | null {
  let max: number | null = null;
  for (const point of points) {
    if (point.t > cutoffMs || !Number.isFinite(point.tempF)) continue;
    if (max == null || point.tempF > max) max = point.tempF;
  }
  return max;
}

export function summarizeBookRows(rows: readonly WxBookDayRow[]): {
  samples: number;
  skipped: number;
  hitRate: number | null;
  pearson: number | null;
} {
  const scored = rows.filter((row) => row.hit != null && row.favoriteMidpoint != null && row.settlementF != null);
  const skipped = rows.length - scored.length;
  if (scored.length === 0) {
    return { samples: 0, skipped, hitRate: null, pearson: null };
  }
  const hits = scored.filter((row) => row.hit).length;
  return {
    samples: scored.length,
    skipped,
    hitRate: hits / scored.length,
    pearson: pearson(
      scored.map((row) => row.favoriteMidpoint!),
      scored.map((row) => row.settlementF!),
    ),
  };
}
