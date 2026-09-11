import type { PricePoint } from "../../../types/financials";
import {
  annualizedVolatility,
  maxDrawdown,
  momentum,
  periodReturns,
  rateOfChange,
  sortinoRatio,
} from "../shared/indicators";

export type SignalTone =
  | "positive"
  | "soft-positive"
  | "negative"
  | "neutral"
  | "emphasis"
  | "muted";

export interface MetricRow {
  label: string;
  value: string;
  tone: SignalTone;
  bold?: boolean;
}

export interface MomentumReturns {
  best: number | null;
  worst: number | null;
  average: number | null;
  count: number;
}

export interface MomentumView {
  rows: MetricRow[];
  returns: MomentumReturns;
  hasData: boolean;
}

/** Momentum and Rate of Change lookback period (bars). */
export const MOMENTUM_PERIOD = 10;

/** Minimum price points required before momentum/risk metrics are meaningful. */
export const MIN_MOMENTUM_POINTS = 30;

/** Minimum daily returns before the best/worst/average summary is shown. */
export const MIN_RETURNS_SAMPLE = 5;

function last<T>(values: T[]): T | undefined {
  return values[values.length - 1];
}

function num(value: number | null | undefined, digits = 2, sign = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = sign && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
}

function signTone(value: number | null | undefined): SignalTone {
  if (value == null || !Number.isFinite(value)) return "muted";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function sortinoTone(value: number | null): SignalTone {
  if (value == null || Number.isNaN(value)) return "muted";
  if (!Number.isFinite(value)) return "positive"; // No downside deviation: ∞
  if (value > 2) return "positive";
  if (value >= 1) return "soft-positive";
  if (value > 0) return "neutral";
  return "negative";
}

export function buildMomentumView(points: PricePoint[], periodsPerYear = 252): MomentumView {
  const closes = points.map((p) => p.close);
  if (closes.length < MIN_MOMENTUM_POINTS) {
    return {
      rows: [],
      returns: { best: null, worst: null, average: null, count: 0 },
      hasData: false,
    };
  }

  const price = last(closes) ?? 0;
  const sortino = sortinoRatio(closes, 0, periodsPerYear);
  const vol = annualizedVolatility(closes, periodsPerYear);
  const drawdown = maxDrawdown(closes);
  const mom = last(momentum(closes, MOMENTUM_PERIOD)) ?? null;
  const roc = last(rateOfChange(closes, MOMENTUM_PERIOD)) ?? null;
  const daily = periodReturns(closes, 1).filter((value) => Number.isFinite(value));

  const momPercent = mom != null && price !== 0 ? (mom / price) * 100 : null;

  const rows: MetricRow[] = [
    {
      label: "Sortino Ratio",
      value: sortino == null
        ? "—"
        : Number.isFinite(sortino)
          ? num(sortino, 2)
          : "∞",
      tone: sortinoTone(sortino),
      bold: true,
    },
    {
      label: "Annualized Vol",
      value: vol == null ? "—" : `${(vol * 100).toFixed(1)}%`,
      tone: vol == null ? "muted" : "emphasis",
    },
    {
      label: "Max Drawdown",
      value: drawdown == null ? "—" : `${(-drawdown * 100).toFixed(1)}%`,
      tone: drawdown == null ? "muted" : "negative",
    },
    {
      label: `Momentum (${MOMENTUM_PERIOD}d)`,
      value: mom == null
        ? "—"
        : `${num(mom, 2, true)}  (${momPercent == null ? "—" : `${momPercent.toFixed(1)}%`} of price)`,
      tone: signTone(mom),
    },
    {
      label: `Rate of Change (${MOMENTUM_PERIOD}d)`,
      value: roc == null ? "—" : `${num(roc, 2, true)}%`,
      tone: signTone(roc),
    },
  ];

  let best: number | null = null;
  let worst: number | null = null;
  let average: number | null = null;
  if (daily.length > 0) {
    best = Math.max(...daily);
    worst = Math.min(...daily);
    average = daily.reduce((sum, value) => sum + value, 0) / daily.length;
  }

  return {
    rows,
    returns: { best, worst, average, count: daily.length },
    hasData: true,
  };
}
