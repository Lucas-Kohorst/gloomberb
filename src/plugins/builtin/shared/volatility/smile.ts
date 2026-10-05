/** All volatilities are decimals, tenors are ACT/365 years and k is log(K/F). */
export interface SmilePoint {
  logMoneyness: number;
  volatility: number;
}

export interface SviParameters {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface SmileFit {
  method: "svi" | "monotone-cubic";
  years: number;
  /** Root mean square error in decimal implied volatility at the retained observations. */
  residual: number;
  points: SmilePoint[];
  droppedPoints: number;
  parameters: SviParameters | null;
  /** Shape-preserving derivatives of total variance with respect to log-moneyness. */
  slopes: number[];
  fallbackReason: string | null;
}

export interface SmileFitOptions {
  maxIterations?: number;
  /** An SVI fit above this IV RMSE falls back to shape-preserving interpolation. */
  maxResidual?: number;
}

/** Gatheral's raw SVI parameterization of total variance, not implied volatility. */
export function sviTotalVariance(parameters: SviParameters, logMoneyness: number): number {
  const { a, b, rho, m, sigma } = parameters;
  const x = logMoneyness - m;
  return a + b * (rho * x + Math.hypot(x, sigma));
}

function validSvi(parameters: SviParameters): boolean {
  const { a, b, rho, m, sigma } = parameters;
  return [a, b, rho, m, sigma].every(Number.isFinite)
    && b >= 0 && Math.abs(rho) < 1 && sigma > 0
    && a + b * sigma * Math.sqrt(1 - rho * rho) >= 0;
}

function linearSolve(matrix: number[][], right: number[]): number[] | null {
  const size = right.length;
  const rows = matrix.map((row, index) => [...row, right[index]!]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-15) return null;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const divisor = rows[column]![column]!;
    for (let index = column; index <= size; index += 1) rows[column]![index]! /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const multiplier = rows[row]![column]!;
      for (let index = column; index <= size; index += 1) {
        rows[row]![index]! -= multiplier * rows[column]![index]!;
      }
    }
  }
  return rows.map((row) => row[size]!);
}

interface ProfileFit {
  location: [number, number];
  parameters: SviParameters | null;
  loss: number;
}

/**
 * With m and sigma fixed, a, b*rho and b are linear least-squares coefficients.
 * Profiling them leaves a deterministic two-dimensional numerical fit. Constraint
 * penalties guide the search, but only a valid raw SVI candidate can be accepted.
 */
function fitSvi(points: SmilePoint[], years: number, maxIterations: number): SviParameters | null {
  const left = points[0]!.logMoneyness;
  const right = points[points.length - 1]!.logMoneyness;
  const width = Math.max(right - left, 0.01);
  const variances = points.map((point) => point.volatility ** 2 * years);
  const scale = Math.max(...variances, 1e-8);
  const profile = (location: [number, number]): ProfileFit => {
    const [m, logSigma] = location;
    const sigma = Math.exp(logSigma);
    if (m < left - 2 * width || m > right + 2 * width || sigma < 1e-5 || sigma > 5 * width) {
      return { location, parameters: null, loss: Infinity };
    }
    const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
    const vector = [0, 0, 0];
    for (let index = 0; index < points.length; index += 1) {
      const x = points[index]!.logMoneyness - m;
      const row = [1, x, Math.hypot(x, sigma)];
      for (let i = 0; i < 3; i += 1) {
        vector[i]! += row[i]! * variances[index]!;
        for (let j = 0; j < 3; j += 1) matrix[i]![j]! += row[i]! * row[j]!;
      }
    }
    const solved = linearSolve(matrix, vector);
    if (!solved) return { location, parameters: null, loss: Infinity };
    const [a, d, b] = solved as [number, number, number];
    const parameters = { a, b, rho: b > 0 ? d / b : 0, m, sigma };
    let loss = 0;
    for (let index = 0; index < points.length; index += 1) {
      const x = points[index]!.logMoneyness - m;
      loss += ((a + d * x + b * Math.hypot(x, sigma) - variances[index]!) / scale) ** 2;
    }
    const minVariance = a + sigma * Math.sqrt(Math.max(0, b * b - d * d));
    loss /= points.length;
    loss += 100 * (Math.min(0, b) ** 2 + Math.max(0, Math.abs(d) - b) ** 2
      + Math.min(0, minVariance) ** 2) / (scale * scale);
    return { location, parameters: validSvi(parameters) ? parameters : null, loss };
  };

  let best: ProfileFit | null = null;
  const remember = (candidate: ProfileFit) => {
    if (candidate.parameters && (!best || candidate.loss < best.loss)) best = candidate;
  };
  for (const startM of [0, (left + right) / 2, left + width / 4]) {
    for (const startSigma of [width / 8, width / 2]) {
      let simplex = [
        profile([startM, Math.log(startSigma)]),
        profile([startM + width / 10, Math.log(startSigma)]),
        profile([startM, Math.log(startSigma) + 0.3]),
      ];
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        simplex.sort((a, b) => a.loss - b.loss);
        const [first, second, worst] = simplex as [ProfileFit, ProfileFit, ProfileFit];
        if (!Number.isFinite(first.loss)) break;
        if (first.loss < 1e-20 || (Math.abs(first.location[0] - worst.location[0]) < 1e-9
          && Math.abs(first.location[1] - worst.location[1]) < 1e-8)) {
          remember(first);
          break;
        }
        const center: [number, number] = [
          (first.location[0] + second.location[0]) / 2,
          (first.location[1] + second.location[1]) / 2,
        ];
        const towards = (origin: [number, number], factor: number) => profile([
          center[0] + factor * (origin[0] - center[0]),
          center[1] + factor * (origin[1] - center[1]),
        ]);
        const reflected = towards(worst.location, -1);
        if (reflected.loss < first.loss) {
          const expanded = towards(reflected.location, 2);
          simplex[2] = expanded.loss < reflected.loss ? expanded : reflected;
        } else if (reflected.loss < second.loss) {
          simplex[2] = reflected;
        } else {
          const outside = reflected.loss < worst.loss;
          const contracted = towards(outside ? reflected.location : worst.location, 0.5);
          if (contracted.loss < (outside ? reflected.loss : worst.loss)) {
            simplex[2] = contracted;
          } else {
            simplex = [first, ...[second, worst].map((candidate) => profile([
              (first.location[0] + candidate.location[0]) / 2,
              (first.location[1] + candidate.location[1]) / 2,
            ]))];
          }
        }
      }
    }
  }
  return (best as ProfileFit | null)?.parameters ?? null;
}

/** Fritsch-Carlson/PCHIP slopes preserve each interval's monotonicity. */
function monotoneSlopes(points: SmilePoint[], years: number): number[] {
  const intervals = points.slice(1).map((point, index) => point.logMoneyness - points[index]!.logMoneyness);
  const secants = points.slice(1).map((point, index) =>
    (point.volatility ** 2 - points[index]!.volatility ** 2) * years / intervals[index]!);
  if (points.length === 2) return [secants[0]!, secants[0]!];
  const slopes = new Array<number>(points.length).fill(0);
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = secants[index - 1]!;
    const after = secants[index]!;
    if (before * after <= 0) continue;
    const firstWeight = 2 * intervals[index]! + intervals[index - 1]!;
    const secondWeight = intervals[index]! + 2 * intervals[index - 1]!;
    slopes[index] = (firstWeight + secondWeight) / (firstWeight / before + secondWeight / after);
  }
  const endpoint = (first: number, second: number, firstWidth: number, secondWidth: number) => {
    const value = ((2 * firstWidth + secondWidth) * first - firstWidth * second) / (firstWidth + secondWidth);
    if (Math.sign(value) !== Math.sign(first)) return 0;
    return Math.sign(first) !== Math.sign(second) && Math.abs(value) > Math.abs(3 * first) ? 3 * first : value;
  };
  slopes[0] = endpoint(secants[0]!, secants[1]!, intervals[0]!, intervals[1]!);
  const last = secants.length - 1;
  slopes[points.length - 1] = endpoint(secants[last]!, secants[last - 1]!, intervals[last]!, intervals[last - 1]!);
  return slopes;
}

export function fitVolatilitySmile(input: readonly SmilePoint[], years: number, options: SmileFitOptions = {}): SmileFit | null {
  if (!Number.isFinite(years) || years <= 0) return null;
  const valid = input.filter((point) => Number.isFinite(point.logMoneyness)
    && Number.isFinite(point.volatility) && point.volatility >= 0
    && Number.isFinite(point.volatility ** 2 * years))
    .map((point) => ({ ...point })).sort((a, b) => a.logMoneyness - b.logMoneyness);
  // Duplicate strikes cannot define separate interpolation knots. Average their
  // total variances; residuals below still measure every retained observation.
  const points: SmilePoint[] = [];
  for (let index = 0; index < valid.length;) {
    const first = valid[index]!;
    let end = index + 1;
    let variance = first.volatility ** 2;
    while (end < valid.length && valid[end]!.logMoneyness === first.logMoneyness) {
      variance += (valid[end]!.volatility ** 2 - variance) / (end - index + 1);
      end += 1;
    }
    points.push({ logMoneyness: first.logMoneyness, volatility: Math.sqrt(variance) });
    index = end;
  }
  if (points.length < 2) return null;
  if (!Number.isFinite(points[points.length - 1]!.logMoneyness - points[0]!.logMoneyness)) return null;
  const requestedIterations = options.maxIterations ?? 250;
  const maxIterations = Number.isFinite(requestedIterations) ? Math.max(0, Math.floor(requestedIterations)) : 250;
  const requestedResidual = options.maxResidual ?? 0.02;
  const maxResidual = Number.isFinite(requestedResidual) && requestedResidual >= 0 ? requestedResidual : 0.02;
  const fit: SmileFit = {
    method: "monotone-cubic", years, residual: 0, points,
    droppedPoints: input.length - valid.length, parameters: null,
    slopes: monotoneSlopes(points, years), fallbackReason: null,
  };
  if (fit.slopes.some((slope) => !Number.isFinite(slope))) return null;
  const residual = () => Math.sqrt(valid.reduce((sum, point) => {
    const volatility = evaluateSmile(fit, point.logMoneyness);
    return volatility == null ? Infinity : sum + (volatility - point.volatility) ** 2 / valid.length;
  }, 0));
  if (points.length < 5) fit.fallbackReason = "SVI needs at least five distinct observations";
  else if (maxIterations === 0) fit.fallbackReason = "SVI iteration limit reached";
  else {
    fit.parameters = fitSvi(points, years, maxIterations);
    if (fit.parameters) {
      fit.method = "svi";
      const sviResidual = residual();
      if (Number.isFinite(sviResidual) && sviResidual <= maxResidual) {
        fit.residual = sviResidual;
        return fit;
      }
      fit.fallbackReason = "SVI residual exceeds the fit tolerance";
    } else fit.fallbackReason = "SVI did not converge to valid parameters";
    fit.method = "monotone-cubic";
    fit.parameters = null;
  }
  fit.residual = residual();
  return Number.isFinite(fit.residual) ? fit : null;
}

/** The cubic fallback uses flat IV outside its observed moneyness range. */
export function evaluateSmile(fit: SmileFit, logMoneyness: number): number | null {
  if (!Number.isFinite(logMoneyness)) return null;
  if (fit.method === "svi" && fit.parameters) {
    const variance = sviTotalVariance(fit.parameters, logMoneyness);
    const volatility = variance >= 0 ? Math.sqrt(variance / fit.years) : NaN;
    return Number.isFinite(volatility) ? volatility : null;
  }
  const first = fit.points[0]!;
  const last = fit.points[fit.points.length - 1]!;
  if (logMoneyness <= first.logMoneyness) return first.volatility;
  if (logMoneyness >= last.logMoneyness) return last.volatility;
  const high = fit.points.findIndex((point) => point.logMoneyness >= logMoneyness);
  const low = high - 1;
  const left = fit.points[low]!;
  const right = fit.points[high]!;
  const width = right.logMoneyness - left.logMoneyness;
  const x = (logMoneyness - left.logMoneyness) / width;
  const variance = (2 * x ** 3 - 3 * x ** 2 + 1) * left.volatility ** 2 * fit.years
    + (x ** 3 - 2 * x ** 2 + x) * width * fit.slopes[low]!
    + (-2 * x ** 3 + 3 * x ** 2) * right.volatility ** 2 * fit.years
    + (x ** 3 - x ** 2) * width * fit.slopes[high]!;
  const volatility = Math.sqrt(Math.max(0, variance) / fit.years);
  return Number.isFinite(volatility) ? volatility : null;
}

export const FIXED_VOLATILITY_TENORS = [
  { label: "1W", years: 7 / 365 }, { label: "2W", years: 14 / 365 },
  { label: "1M", years: 30 / 365 }, { label: "2M", years: 60 / 365 },
  { label: "3M", years: 90 / 365 }, { label: "6M", years: 180 / 365 },
  { label: "1Y", years: 1 },
] as const;

export interface VolatilityTenorPoint {
  years: number;
  volatility: number;
}

export interface InterpolatedVolatility extends VolatilityTenorPoint {
  totalVariance: number;
  interpolated: boolean;
  extrapolated: boolean;
  sourceYears: [number, number];
}

function validTenors(input: readonly VolatilityTenorPoint[]): VolatilityTenorPoint[] {
  return input.filter((point) => Number.isFinite(point.years) && point.years > 0
    && Number.isFinite(point.volatility) && point.volatility >= 0
    && Number.isFinite(point.volatility ** 2 * point.years))
    .slice().sort((a, b) => a.years - b.years);
}

/**
 * Interpolate total variance at a fixed log-moneyness, never IV. Outside the
 * observed range, hold the nearest IV constant and explicitly mark extrapolation.
 * Conflicting duplicate tenors are ambiguous and return null.
 */
export function interpolateTotalVariance(input: readonly VolatilityTenorPoint[], years: number): InterpolatedVolatility | null {
  if (!Number.isFinite(years) || years < 0) return null;
  const points = validTenors(input);
  if (!points.length || points.some((point, index) => index > 0 && point.years === points[index - 1]!.years
    && point.volatility !== points[index - 1]!.volatility)) return null;
  const exact = points.find((point) => point.years === years);
  if (exact) return { years, volatility: exact.volatility, totalVariance: exact.volatility ** 2 * years,
    interpolated: false, extrapolated: false, sourceYears: [years, years] };
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (years < first.years || years > last.years) {
    const nearest = years < first.years ? first : last;
    const totalVariance = nearest.volatility ** 2 * years;
    if (!Number.isFinite(totalVariance)) return null;
    return { years, volatility: nearest.volatility, totalVariance,
      interpolated: false, extrapolated: true, sourceYears: [nearest.years, nearest.years] };
  }
  const high = points.findIndex((point) => point.years > years);
  const left = points[high - 1]!;
  const right = points[high]!;
  const weight = (years - left.years) / (right.years - left.years);
  const totalVariance = (1 - weight) * left.volatility ** 2 * left.years + weight * right.volatility ** 2 * right.years;
  const volatility = Math.sqrt(totalVariance / years);
  if (!Number.isFinite(totalVariance) || !Number.isFinite(volatility)) return null;
  return { years, volatility, totalVariance,
    interpolated: true, extrapolated: false, sourceYears: [left.years, right.years] };
}

export interface CalendarArbitrageWarning {
  kind: "calendar";
  earlierYears: number;
  laterYears: number;
  earlierVariance: number;
  laterVariance: number;
}

/** Call once per fixed log-moneyness. Observations are reported without repair. */
export function detectCalendarArbitrage(input: readonly VolatilityTenorPoint[], tolerance = 1e-10): CalendarArbitrageWarning[] {
  const points = validTenors(input);
  const groups: { years: number; minVariance: number; maxVariance: number }[] = [];
  for (const point of points) {
    const variance = point.volatility ** 2 * point.years;
    const previous = groups.at(-1);
    if (previous?.years === point.years) {
      previous.minVariance = Math.min(previous.minVariance, variance);
      previous.maxVariance = Math.max(previous.maxVariance, variance);
    } else groups.push({ years: point.years, minVariance: variance, maxVariance: variance });
  }
  const warnings: CalendarArbitrageWarning[] = [];
  for (let index = 1; index < groups.length; index += 1) {
    const earlier = groups[index - 1]!;
    const later = groups[index]!;
    // A conflicting duplicate must not hide a calendar violation. Compare the
    // most adverse observed pair at each adjacent pair of distinct tenors.
    const earlierVariance = earlier.maxVariance;
    const laterVariance = later.minVariance;
    if (laterVariance < earlierVariance - Math.max(0, tolerance)) {
      warnings.push({ kind: "calendar", earlierYears: earlier.years, laterYears: later.years, earlierVariance, laterVariance });
    }
  }
  return warnings;
}

export interface CallPricePoint {
  strike: number;
  callPrice: number;
}

export interface ButterflyArbitrageWarning {
  kind: "butterfly";
  strikes: [number, number, number];
  leftSlope: number;
  rightSlope: number;
}

/** Convex call prices require increasing slopes, including on uneven strike grids. */
export function detectButterflyArbitrage(input: readonly CallPricePoint[], tolerance = 1e-8): ButterflyArbitrageWarning[] {
  const points = input.filter((point) => Number.isFinite(point.strike) && point.strike > 0
    && Number.isFinite(point.callPrice) && point.callPrice >= 0)
    .slice().sort((a, b) => a.strike - b.strike);
  const groups: { strike: number; minPrice: number; maxPrice: number }[] = [];
  for (const point of points) {
    const previous = groups.at(-1);
    if (previous?.strike === point.strike) {
      previous.minPrice = Math.min(previous.minPrice, point.callPrice);
      previous.maxPrice = Math.max(previous.maxPrice, point.callPrice);
    } else groups.push({ strike: point.strike, minPrice: point.callPrice, maxPrice: point.callPrice });
  }
  const warnings: ButterflyArbitrageWarning[] = [];
  for (let index = 1; index < groups.length - 1; index += 1) {
    const left = groups[index - 1]!;
    const center = groups[index]!;
    const right = groups[index + 1]!;
    // Duplicate quotes may disagree. The highest center and lowest wings give
    // the worst convexity, so provider ordering cannot suppress the warning.
    const leftSlope = (center.maxPrice - left.minPrice) / (center.strike - left.strike);
    const rightSlope = (right.minPrice - center.maxPrice) / (right.strike - center.strike);
    if (rightSlope < leftSlope - Math.max(0, tolerance)) {
      warnings.push({ kind: "butterfly", strikes: [left.strike, center.strike, right.strike], leftSlope, rightSlope });
    }
  }
  return warnings;
}
