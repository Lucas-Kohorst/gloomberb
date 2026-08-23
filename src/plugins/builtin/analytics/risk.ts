import type { ProjectedChartPoint } from "../../../components/chart/core/data";
import { computeDatedBeta, type DatedReturn } from "./metrics";

export const TRADING_DAYS_PER_YEAR = 252;

/** z-scores for the upper tail of the standard normal distribution. */
const Z_SCORES: Record<number, number> = {
  0.90: 1.2816,
  0.95: 1.6449,
  0.99: 2.3263,
};

const DEFAULT_CONFIDENCE = 0.95;

export function zScore(confidence: number): number {
  return Z_SCORES[confidence] ?? Z_SCORES[DEFAULT_CONFIDENCE]!;
}

export interface VaRResult {
  /** Confidence level, e.g. 0.95 for 95%. */
  confidence: number;
  /** 1-day historical VaR as a positive dollar loss, or null if insufficient data. */
  historical: number | null;
  /** 1-day parametric (variance-covariance) VaR as a positive dollar loss, or null. */
  parametric: number | null;
}

/**
 * Historical Value-at-Risk: the portfolio loss at the (1 - confidence) quantile
 * of the empirical daily return distribution. Returns a positive dollar loss.
 */
export function computeHistoricalVaR(
  returns: number[],
  confidence: number,
  portfolioValue: number,
): number | null {
  if (returns.length < 10 || portfolioValue <= 0) return null;
  const sorted = [...returns].sort((left, right) => left - right);
  const quantileIndex = Math.floor((1 - confidence) * (sorted.length - 1));
  const percentileReturn = sorted[Math.max(0, Math.min(sorted.length - 1, quantileIndex))]!;
  // A negative return is a loss; VaR is the magnitude of that loss.
  return Math.max(0, -percentileReturn * portfolioValue);
}

/**
 * Parametric (variance-covariance) Value-at-Risk assuming normally distributed
 * daily returns: VaR = portfolioValue * (z * std - mean). Returns a positive
 * dollar loss, or null if returns have zero variance / insufficient data.
 */
export function computeParametricVaR(
  returns: number[],
  confidence: number,
  portfolioValue: number,
): number | null {
  if (returns.length < 10 || portfolioValue <= 0) return null;
  const n = returns.length;
  const mean = returns.reduce((sum, value) => sum + value, 0) / n;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std < 1e-12) return null;
  const z = zScore(confidence);
  const dailyLossReturn = z * std - mean;
  return Math.max(0, dailyLossReturn * portfolioValue);
}

export function computeVaR(
  returns: number[],
  confidence: number,
  portfolioValue: number,
): VaRResult {
  return {
    confidence,
    historical: computeHistoricalVaR(returns, confidence, portfolioValue),
    parametric: computeParametricVaR(returns, confidence, portfolioValue),
  };
}

/**
 * Annualized portfolio volatility (daily std dev * sqrt(252)) as a fraction,
 * e.g. 0.18 for 18%. Returns null for insufficient or zero-variance data.
 */
export function computeAnnualizedVolatility(returns: number[]): number | null {
  if (returns.length < 10) return null;
  const n = returns.length;
  const mean = returns.reduce((sum, value) => sum + value, 0) / n;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  if (variance < 1e-24) return null;
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

export interface FactorExposure {
  factor: string;
  /** Beta of the portfolio's daily returns to the factor proxy's daily returns. */
  beta: number | null;
  /** Dollar exposure to the factor: beta * portfolioValue. */
  exposure: number | null;
}

export interface FactorReturnSeries {
  factor: string;
  returns: DatedReturn[];
}

/**
 * Factor exposure for the portfolio against a set of factor proxy return series
 * (market, size, value, momentum). Each beta is the regression coefficient of
 * aligned portfolio daily returns on the factor proxy daily returns.
 */
export function computeFactorExposure(
  portfolioReturns: DatedReturn[] | null,
  factors: FactorReturnSeries[],
  portfolioValue: number,
): FactorExposure[] {
  return factors.map(({ factor, returns }) => {
    const beta = portfolioReturns ? computeDatedBeta(portfolioReturns, returns) : null;
    return {
      factor,
      beta,
      exposure: beta != null ? beta * portfolioValue : null,
    };
  });
}

/**
 * Beta-weighted market exposure: portfolio beta to the market proxy multiplied
 * by portfolio value. Equivalent to the "market" row of factor exposure.
 */
export function computeBetaWeightedMarketExposure(
  portfolioReturns: DatedReturn[] | null,
  marketReturns: DatedReturn[] | null,
  portfolioValue: number,
): number | null {
  if (!portfolioReturns || !marketReturns || portfolioValue <= 0) return null;
  const beta = computeDatedBeta(portfolioReturns, marketReturns);
  return beta != null ? beta * portfolioValue : null;
}

export interface PositionContribution {
  symbol: string;
  name: string;
  sector: string;
  marketValue: number;
  /** Fraction of the portfolio's total market value (0..1). */
  weight: number;
  /** The position's own total return over the lookback window, or null. */
  returnPct: number | null;
  /** Return contribution to the portfolio (returnPct * weight), in pct points. */
  returnContribution: number | null;
  /** Dollar P&L attributable to the position over the window (returnPct * marketValue). */
  dollarContribution: number | null;
}

export interface ContributorResult {
  byPosition: PositionContribution[];
  byReturn: PositionContribution[];
}

export interface ContributorInput {
  symbol: string;
  name?: string;
  sector?: string;
  marketValue: number;
  returnPct?: number | null;
}

/**
 * Best/worst contributors, ranked both by position size (market value) and by
 * return contribution (returnPct * weight). Each list is sorted descending so
 * the "best" are at the head and the "worst" at the tail; the caller can slice
 * whichever side it needs.
 */
export function computeContributors(
  inputs: ContributorInput[],
  limit = 5,
): ContributorResult {
  const totalValue = inputs.reduce((sum, item) => sum + Math.max(0, item.marketValue), 0);
  if (totalValue <= 0) {
    return { byPosition: [], byReturn: [] };
  }

  const enriched: PositionContribution[] = inputs
    .filter((item) => Number.isFinite(item.marketValue) && item.marketValue > 0)
    .map((item) => {
      const weight = item.marketValue / totalValue;
      const returnPct = Number.isFinite(item.returnPct ?? NaN) ? item.returnPct ?? null : null;
      return {
        symbol: item.symbol,
        name: item.name ?? item.symbol,
        sector: item.sector ?? "Unknown",
        marketValue: item.marketValue,
        weight,
        returnPct,
        returnContribution: returnPct != null ? returnPct * weight : null,
        dollarContribution: returnPct != null ? returnPct * item.marketValue : null,
      };
    });

  const byPosition = [...enriched]
    .sort((left, right) => right.marketValue - left.marketValue)
    .slice(0, limit);

  const withReturns = enriched.filter((item) => item.returnContribution != null);
  const byReturn = [...withReturns]
    .sort((left, right) => (right.returnContribution ?? 0) - (left.returnContribution ?? 0))
    .slice(0, limit);

  return { byPosition, byReturn };
}

/** Split a ranked list into best (head) and worst (tail) halves. */
export function splitBestWorst<T>(ranked: T[], count: number): { best: T[]; worst: T[] } {
  if (ranked.length === 0 || count <= 0) return { best: [], worst: [] };
  const best = ranked.slice(0, count);
  const worst = [...ranked].reverse().slice(0, count);
  return { best, worst };
}

/**
 * Build renderer-neutral chart points for a cumulative return series, suitable
 * for `StaticChartSurface`. The cumulative return is the running sum of daily
 * returns (not compounded), matching the analytics pane's existing convention.
 */
export function buildCumulativeReturnChartPoints(returns: DatedReturn[]): ProjectedChartPoint[] {
  let cumulative = 0;
  return returns.map((point) => {
    cumulative += point.value;
    const date = new Date(`${point.dateKey}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime())) return null;
    return {
      date,
      open: cumulative,
      high: cumulative,
      low: cumulative,
      close: cumulative,
      volume: 0,
    } satisfies ProjectedChartPoint;
  }).filter((point): point is ProjectedChartPoint => point !== null);
}
