import type { TrendSummary } from "../shared/indicators";

export interface TrendMetricRow {
  label: string;
  value: string;
  emphasis?: "bullish" | "bearish" | "neutral";
}

export function formatTrendValue(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function trendEmphasis(value: string): TrendMetricRow["emphasis"] {
  if (value === "bullish" || value === "above") return "bullish";
  if (value === "bearish" || value === "below") return "bearish";
  return "neutral";
}

export function trendScoreLabel(score: number): string {
  return `${score >= 0 ? "+" : ""}${Math.round(score)}`;
}

export function buildTrendMetricRows(summary: TrendSummary): TrendMetricRow[] {
  const strengthEmphasis = summary.adxTrend === "strong"
    ? trendEmphasis(summary.direction)
    : "neutral";
  return [
    {
      label: "ADX",
      value: summary.adx == null ? "—" : summary.adx.toFixed(1),
      emphasis: strengthEmphasis,
    },
    {
      label: "Trend strength",
      value: formatTrendValue(summary.adxTrend),
      emphasis: strengthEmphasis,
    },
    {
      label: "Direction",
      value: formatTrendValue(summary.direction),
      emphasis: trendEmphasis(summary.direction),
    },
    {
      label: "MA alignment",
      value: formatTrendValue(summary.maAlignment),
      emphasis: trendEmphasis(summary.maAlignment),
    },
    {
      label: "Aroon Up",
      value: summary.aroonUp == null ? "—" : summary.aroonUp.toFixed(0),
      emphasis: "bullish",
    },
    {
      label: "Aroon Down",
      value: summary.aroonDown == null ? "—" : summary.aroonDown.toFixed(0),
      emphasis: "bearish",
    },
    {
      label: "Momentum",
      value: summary.momentum == null ? "—" : summary.momentum.toFixed(2),
      emphasis: summary.momentum == null
        ? "neutral"
        : summary.momentum > 0
          ? "bullish"
          : summary.momentum < 0
            ? "bearish"
            : "neutral",
    },
    {
      label: "Price vs SMA 20",
      value: formatTrendValue(summary.priceVsSma20),
      emphasis: trendEmphasis(summary.priceVsSma20),
    },
    {
      label: "Price vs SMA 50",
      value: formatTrendValue(summary.priceVsSma50),
      emphasis: trendEmphasis(summary.priceVsSma50),
    },
    {
      label: "Price vs SMA 200",
      value: formatTrendValue(summary.priceVsSma200),
      emphasis: trendEmphasis(summary.priceVsSma200),
    },
  ];
}
