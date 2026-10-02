import type { YieldPoint } from "../yield-curve/treasury-data";

export interface SurfaceRate {
  rate: number | null;
  method: "unavailable" | "treasury-exact" | "treasury-boundary" | "treasury-interpolated";
  asOf: string[];
  warnings: string[];
}

type CurvePoint = YieldPoint & { stale?: boolean };

const positive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** The 1M bill is the shortest published Treasury tenor. */
const SHORTEST_TREASURY_YEARS = 1 / 12;

/** Treasury yields are percent. Linear tenor interpolation uses decimal yields in the pricer. */
export function surfaceTreasuryRate(curve: readonly CurvePoint[], years: number): SurfaceRate {
  const missing = (): SurfaceRate => ({ rate: null, method: "unavailable", asOf: [], warnings: ["Treasury rate unavailable"] });
  if (!positive(years)) return missing();
  const points = curve
    .filter((point) => positive(point.maturityYears) && point.yield != null && Number.isFinite(point.yield))
    .slice()
    .sort((a, b) => a.maturityYears - b.maturityYears);
  if (!points.length) return missing();
  const exact = points.find((point) => point.maturityYears === years);
  const rightIndex = points.findIndex((point) => point.maturityYears > years);
  const left = exact ?? (rightIndex < 0 ? points.at(-1)! : points[Math.max(0, rightIndex - 1)]!);
  const right = exact ?? (rightIndex < 0 ? left : points[rightIndex]!);
  const weight = left === right ? 0 : (years - left.maturityYears) / (right.maturityYears - left.maturityYears);
  const rate = (left.yield! + weight * (right.yield! - left.yield!)) / 100;
  if (!Number.isFinite(rate)) return missing();
  const asOf = [...new Set([left.asOf, right.asOf].filter((date): date is string => typeof date === "string" && Number.isFinite(Date.parse(date))))];
  const method = exact ? "treasury-exact" : left === right ? "treasury-boundary" : "treasury-interpolated";
  const warnings: string[] = [];
  if (method === "treasury-boundary" && (years > left.maturityYears || left.maturityYears > SHORTEST_TREASURY_YEARS + 1e-9)) {
    warnings.push(`Treasury ${left.maturity} rate held outside the published tenor range`);
  }
  if (asOf.length === 0) warnings.push("Treasury observation date unavailable");
  if (asOf.length > 1) warnings.push("Treasury interpolation uses different source dates");
  if (left.stale || right.stale) warnings.push("Treasury source is stale");
  return { rate, method, asOf, warnings };
}
