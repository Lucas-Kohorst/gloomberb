import { formatCompact } from "../../../utils/format";
import type { TechnicalSummary } from "../shared/indicators";

export type SignalTone =
  | "positive"
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

export interface MetricSection {
  title: string;
  rows: MetricRow[];
}

export interface TechnicalSummaryView {
  sections: MetricSection[];
  summary: string;
  hasData: boolean;
}

/** Minimum price points required before any indicator is meaningful. */
export const MIN_INDICATOR_POINTS = 30;

function num(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function oscTone(signal: TechnicalSummary["rsiSignal"]): SignalTone {
  switch (signal) {
    case "overbought": return "negative";
    case "oversold": return "positive";
    default: return "neutral";
  }
}

function macdTone(type: TechnicalSummary["macdSignalType"]): SignalTone {
  switch (type) {
    case "bullish": return "positive";
    case "bearish": return "negative";
    default: return "neutral";
  }
}

function bollingerLabel(position: TechnicalSummary["bollingerPosition"]): string {
  switch (position) {
    case "above-upper": return "Above upper band";
    case "at-upper": return "At upper band";
    case "within": return "Within bands";
    case "at-lower": return "At lower band";
    case "below-lower": return "Below lower band";
  }
}

function bollingerTone(position: TechnicalSummary["bollingerPosition"]): SignalTone {
  switch (position) {
    case "above-upper": return "negative";
    case "at-upper": return "emphasis";
    case "within": return "neutral";
    case "at-lower": return "positive";
    case "below-lower": return "positive";
  }
}

function adxLabel(adx: number | null): string {
  if (adx == null) return "—";
  if (adx >= 25) return "strong";
  if (adx >= 20) return "weak";
  return "ranging";
}

function adxTone(adx: number | null): SignalTone {
  if (adx == null) return "muted";
  if (adx >= 25) return "emphasis";
  if (adx >= 20) return "neutral";
  return "muted";
}

function nullable(row: MetricRow, present: boolean): MetricRow {
  return present ? row : { ...row, value: "—", tone: "muted" };
}

export function buildTechnicalSummaryView(summary: TechnicalSummary): TechnicalSummaryView {
  const hasIndicators =
    summary.rsi != null
    || summary.stochasticK != null
    || summary.macd != null
    || summary.adx != null;

  const sections: MetricSection[] = [
    {
      title: "Oscillators",
      rows: [
        nullable(
          {
            label: "RSI (14)",
            value: num(summary.rsi, 1),
            tone: oscTone(summary.rsiSignal),
          },
          summary.rsi != null,
        ),
        nullable(
          {
            label: "Stochastic %K",
            value: num(summary.stochasticK, 1),
            tone: oscTone(summary.stochasticSignal),
          },
          summary.stochasticK != null,
        ),
        nullable(
          {
            label: "Stochastic %D",
            value: num(summary.stochasticD, 1),
            tone: "neutral",
          },
          summary.stochasticD != null,
        ),
      ],
    },
    {
      title: "Trend",
      rows: [
        nullable(
          {
            label: "MACD Line",
            value: num(summary.macd, 3),
            tone: macdTone(summary.macdSignalType),
          },
          summary.macd != null,
        ),
        nullable(
          {
            label: "MACD Signal",
            value: num(summary.macdSignal, 3),
            tone: "neutral",
          },
          summary.macdSignal != null,
        ),
        nullable(
          {
            label: "MACD Histogram",
            value: num(summary.macdHistogram, 3),
            tone: macdTone(summary.macdSignalType),
          },
          summary.macdHistogram != null,
        ),
        nullable(
          {
            label: "ADX (14)",
            value: summary.adx == null ? "—" : `${num(summary.adx, 1)}  ${adxLabel(summary.adx)}`,
            tone: adxTone(summary.adx),
          },
          summary.adx != null,
        ),
      ],
    },
    {
      title: "Volatility",
      rows: [
        {
          label: "Bollinger",
          value: bollingerLabel(summary.bollingerPosition),
          tone: bollingerTone(summary.bollingerPosition),
        },
        nullable(
          {
            label: "Band Width",
            value: `${(summary.bollingerWidth! * 100).toFixed(2)}%`,
            tone: "neutral",
          },
          summary.bollingerWidth != null,
        ),
      ],
    },
    {
      title: "Volume",
      rows: [
        nullable(
          {
            label: "Avg Volume (20d)",
            value: formatCompact(summary.volumeAvg ?? undefined),
            tone: "neutral",
          },
          summary.volumeAvg != null,
        ),
        nullable(
          {
            label: "Volume Ratio",
            value: `${summary.volumeRatio!.toFixed(2)}x`,
            tone: summary.volumeRatio! > 1.5 ? "emphasis" : "neutral",
          },
          summary.volumeRatio != null,
        ),
      ],
    },
  ];

  return {
    sections,
    summary: summary.summary,
    hasData: hasIndicators,
  };
}
