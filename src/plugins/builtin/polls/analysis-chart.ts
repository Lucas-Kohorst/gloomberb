import {
  pricePointsToResolvedSeries,
} from "../../../components/chart/composite";
import type { ResolvedSeries } from "../../../time-series/types";
import type { PricePoint } from "../../../types/financials";
import {
  computeMovingAverage,
  computePollsterHouseSeries,
  groupPollTrendByPollster,
  pollRaceKey,
} from "./normalize";
import type { PollAnalysisGroup, PollAnalysisView, PollRow, PollTrendPoint } from "./types";
import type { PollRaceMarketOverlay } from "./overlay";

export const POLL_ANALYSIS_TREND_WINDOW = 5;
export const POLL_ANALYSIS_MAX_POLLSTERS = 8;

export function pollPointsToPricePoints(points: PollTrendPoint[]): PricePoint[] {
  return points.flatMap((point) => {
    const date = new Date(`${point.date}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return [];
    return [{ date, close: point.value }];
  });
}

export function pollsterSeriesColor(index: number, palette: readonly string[]): string {
  return palette[index % palette.length] ?? palette[0] ?? "#888888";
}

export function buildPollAnalysisSeries(options: {
  rows: PollRow[];
  poll: PollRow;
  choice: string;
  group: PollAnalysisGroup;
  view: PollAnalysisView;
  palette: readonly string[];
  market?: PollRaceMarketOverlay | null;
  movingAverageColor?: string;
  marketColor?: string;
}): ResolvedSeries[] {
  const raceKey = pollRaceKey(options.poll);
  const grouped = options.group === "house"
    ? [{
      pollster: options.poll.pollster,
      points: computePollsterHouseSeries(options.rows, raceKey, options.poll.pollster, options.choice),
    }]
    : groupPollTrendByPollster(options.rows, raceKey, options.choice, POLL_ANALYSIS_MAX_POLLSTERS);

  const style = options.view === "scatter" ? "points" : "line";
  const series: ResolvedSeries[] = [];

  for (let index = 0; index < grouped.length; index++) {
    const entry = grouped[index]!;
    if (entry.points.length === 0) continue;
    series.push(pricePointsToResolvedSeries(pollPointsToPricePoints(entry.points), {
      id: `pollster:${entry.pollster}`,
      label: entry.pollster,
      color: pollsterSeriesColor(index, options.palette),
      unit: "%",
      unitGroup: "percent",
      style,
      axis: "left",
      panelId: "pct",
      providerId: "votehub",
    }));
  }

  if (options.group === "house" && options.view === "overlay") {
    const house = grouped[0]?.points ?? [];
    const ma = computeMovingAverage(house, POLL_ANALYSIS_TREND_WINDOW);
    if (ma.length > 0) {
      series.push(pricePointsToResolvedSeries(pollPointsToPricePoints(ma.map((point) => ({
        date: point.date,
        value: point.value,
        pollster: options.poll.pollster,
      }))), {
        id: "house-ma",
        label: `${POLL_ANALYSIS_TREND_WINDOW}-poll avg`,
        color: options.movingAverageColor ?? options.palette[0] ?? "#22aa66",
        unit: "%",
        unitGroup: "percent",
        style: "line",
        axis: "left",
        panelId: "pct",
        providerId: "votehub",
      }));
    }
  }

  if (options.market && options.market.points.length > 0) {
    series.push(pricePointsToResolvedSeries(options.market.points, {
      id: `pm:${options.market.marketId}`,
      label: options.market.label,
      color: options.marketColor ?? "#ddaa00",
      unit: "%",
      unitGroup: "percent",
      style: "line",
      axis: "left",
      panelId: "pct",
      providerId: "adjacent",
    }));
  }

  return series;
}
