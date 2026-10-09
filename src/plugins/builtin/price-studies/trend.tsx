import { useMemo } from "react";
import { StatGrid, type StatItem } from "../../../components";
import { PriceStudyGate, usePriceStudyHistory } from "./history";
import { computeTrendSummary, type TrendSummary } from "./math";

function level(value: number | null, digits: number): string {
  return value == null ? "—" : value.toFixed(digits);
}

function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toneOf(value: TrendSummary["direction"] | TrendSummary["maAlignment"] | TrendSummary["priceVsSma20"]): StatItem["tone"] {
  if (value === "bullish" || value === "above") return "positive";
  if (value === "bearish" || value === "below") return "negative";
  return "muted";
}

export function TrendPane({ width, height, focused }: { width: number; height: number; focused: boolean }) {
  const { symbol, equity, history } = usePriceStudyHistory(focused, "trend");
  const items = useMemo((): StatItem[] => {
    const points = history.data?.history;
    if (!points?.length) return [];
    const summary = computeTrendSummary(points);
    const alignment = `${summary.priceVsSma20} 20 · ${summary.priceVsSma50} 50 · ${summary.priceVsSma200} 200`;
    return [
      { id: "adx", label: "ADX", value: level(summary.adx, 1), detail: "14" },
      { id: "plus", label: "+DI", value: level(summary.plusDI, 1), detail: "14" },
      { id: "minus", label: "-DI", value: level(summary.minusDI, 1), detail: "14" },
      { id: "aroon-up", label: "Aroon up", value: level(summary.aroonUp, 0), detail: "25" },
      { id: "aroon-down", label: "Aroon down", value: level(summary.aroonDown, 0), detail: "25" },
      { id: "alignment", label: "Alignment", value: label(summary.maAlignment), detail: alignment, tone: toneOf(summary.maAlignment), wide: true },
      { id: "direction", label: "Direction", value: label(summary.direction), tone: toneOf(summary.direction) },
      {
        id: "strength",
        label: "Strength",
        value: label(summary.adxTrend),
        tone: summary.adxTrend === "strong" ? toneOf(summary.direction) : "muted",
      },
    ];
  }, [history.data]);

  return (
    <PriceStudyGate
      symbol={symbol}
      equity={equity}
      loading={history.loading}
      error={history.error}
      points={history.data?.history ?? null}
      subject="trend"
      width={width}
      height={height}
    >
      {() => <StatGrid items={items} width={width} />}
    </PriceStudyGate>
  );
}
