import { useMemo } from "react";
import { StatGrid, type StatItem } from "../../../components";
import { PriceStudyGate, usePriceStudyHistory } from "./history";
import { momentumSnapshot } from "./math";

function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  if (!/[1-9]/.test(text)) return text;
  return `${value > 0 ? "+" : "-"}${text}`;
}

function percentFromFraction(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${signed(value * 100, digits)}%`;
}

function percentAlready(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${signed(value, digits)}%`;
}

function toneOf(value: number | null): StatItem["tone"] {
  if (value == null || value === 0 || Number.isNaN(value)) return "muted";
  if (!Number.isFinite(value)) return value > 0 ? "positive" : "muted";
  return value > 0 ? "positive" : "negative";
}

export function MomentumPane({ width, height, focused }: { width: number; height: number; focused: boolean }) {
  const { symbol, equity, history } = usePriceStudyHistory(focused, "momentum");
  const items = useMemo((): StatItem[] => {
    const points = history.data?.history;
    if (!points) return [];
    const stats = momentumSnapshot(points);
    const sortino = stats.sortino == null ? "—" : Number.isFinite(stats.sortino) ? stats.sortino.toFixed(2) : "∞";
    return [
      { id: "momentum", label: "10d momentum", value: stats.momentum == null ? "—" : signed(stats.momentum, 2), tone: toneOf(stats.momentum) },
      { id: "roc", label: "Rate of change", value: percentAlready(stats.rateOfChange), detail: "10d", tone: toneOf(stats.rateOfChange) },
      { id: "vol", label: "Volatility", value: percentFromFraction(stats.volatility), detail: "annualized" },
      { id: "sortino", label: "Sortino", value: sortino, tone: toneOf(stats.sortino ?? null) },
      { id: "drawdown", label: "Max drawdown", value: percentFromFraction(stats.maxDrawdown == null ? null : -stats.maxDrawdown), tone: stats.maxDrawdown ? "negative" : "muted" },
      { id: "best", label: "Best day", value: percentFromFraction(stats.bestDay, 2), tone: toneOf(stats.bestDay) },
      { id: "worst", label: "Worst day", value: percentFromFraction(stats.worstDay, 2), tone: toneOf(stats.worstDay) },
      { id: "average", label: "Average day", value: percentFromFraction(stats.averageDay, 2), tone: toneOf(stats.averageDay) },
    ];
  }, [history.data]);

  return (
    <PriceStudyGate
      symbol={symbol}
      equity={equity}
      loading={history.loading}
      error={history.error}
      points={history.data?.history ?? null}
      subject="momentum"
      width={width}
      height={height}
    >
      {() => <StatGrid items={items} width={width} />}
    </PriceStudyGate>
  );
}
