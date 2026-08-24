import { resolveChartPalette } from "../../../components/chart/core/renderer";
import { colors, priceColor } from "../../../theme/colors";
import type { TickerFinancials, PricePoint } from "../../../types/financials";
import type { BrokerPortfolioPerformance } from "../../../types/trading";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import { formatCompact, formatNumber, formatPercentRaw } from "../../../utils/format";
import { formatRelativeAge } from "../../../utils/relative-time";
import { instrumentFromTicker, type ChartRequest } from "../../../market-data/request-types";
import { buildChartKey } from "../../../market-data/selectors";
import { resolvePortfolioAccountMetrics, resolvePortfolioMarketValue } from "../portfolio-list/account-metrics";
import type { ColumnContext, PortfolioSummaryTotals } from "../portfolio-list/metrics";
import type { ResolvedPortfolioAccountState } from "../portfolio-list/summary";
import { performancePointValue } from "./broker-performance";
import {
  betaColor,
  betaLabel,
  formatReturn,
  formatSignedCompact,
  sharpeColor,
  sharpeLabel,
} from "./display";
import {
  computeDatedReturns,
  computeWeightedPortfolioReturns,
  type DatedReturn,
  type WeightedReturnSeries,
} from "./metrics";
import { getPortfolioPositionValue } from "./sector-model";
import { type ContributorInput, type FactorReturnSeries } from "./risk";
import type { AnalyticsMetricRow } from "./view";

export interface PortfolioChartTarget {
  ticker: TickerRecord;
  request: ChartRequest;
}

export type ChartEntryLookup = Map<string, {
  data?: PricePoint[] | null;
  lastGoodData?: PricePoint[] | null;
} | undefined>;

function formatIsoDateMonthDay(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatAccountFreshness(account: ResolvedPortfolioAccountState["account"] | undefined): string | null {
  if (!account) return null;
  if (account.asOfDate) return formatIsoDateMonthDay(account.asOfDate);
  return account.updatedAt ? formatRelativeAge(account.updatedAt) : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatMarginLeverage(netLiquidation: number | undefined, totalMarketValue: number): string | null {
  if (!finiteNumber(netLiquidation) || !finiteNumber(totalMarketValue) || totalMarketValue <= 0) return null;
  return `${(netLiquidation / totalMarketValue).toFixed(1)}x`;
}

export function buildPortfolioChartTargets(portfolioTickers: TickerRecord[]): PortfolioChartTarget[] {
  return portfolioTickers.flatMap((ticker) => {
    const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
    if (!instrument) return [];
    return [{
      ticker,
      request: {
        instrument,
        bufferRange: "1Y" as const,
        granularity: "range" as const,
      },
    }];
  });
}

export function buildPortfolioReturnSeries({
  chartTargets,
  chartEntries,
  financials,
  columnContext,
  equalWeight = false,
}: {
  chartTargets: PortfolioChartTarget[];
  chartEntries: ChartEntryLookup;
  financials: Map<string, TickerFinancials>;
  columnContext: ColumnContext;
  equalWeight?: boolean;
}): DatedReturn[] | null {
  const weightedSeries: WeightedReturnSeries[] = [];
  const equalShare = chartTargets.length > 0 ? 1 / chartTargets.length : 0;
  for (const { ticker, request } of chartTargets) {
    const key = buildChartKey(request);
    const entry = chartEntries.get(key);
    const history = entry?.data ?? entry?.lastGoodData ?? null;
    if (!history || history.length < 11) continue;

    const returns = computeDatedReturns(history);
    if (returns.length < 10) continue;

    const value = equalWeight
      ? equalShare
      : getPortfolioPositionValue(ticker, financials.get(ticker.metadata.ticker), columnContext);
    if (value == null) continue;
    weightedSeries.push({ weight: value, returns });
  }

  const returns = computeWeightedPortfolioReturns(weightedSeries);
  return returns.length > 0 ? returns : null;
}

export function buildBenchmarkReturnSeries(
  request: ChartRequest,
  chartEntries: ChartEntryLookup,
): DatedReturn[] | null {
  const entry = chartEntries.get(buildChartKey(request));
  const history = entry?.data ?? entry?.lastGoodData ?? null;
  if (!history || history.length < 11) return null;
  const returns = computeDatedReturns(history);
  return returns.length > 0 ? returns : null;
}

export function buildAnalyticsSummaryRows({
  accountState,
  brokerPerformance,
  portfolioStats,
  convertAccountValue = (value) => value,
}: {
  accountState: ResolvedPortfolioAccountState | null;
  activePortfolio: Portfolio | null;
  brokerPerformance: BrokerPortfolioPerformance | null;
  portfolioStats: PortfolioSummaryTotals;
  convertAccountValue?: (value: number) => number;
}): AnalyticsMetricRow[] {
  const rows: AnalyticsMetricRow[] = [];
  const account = accountState?.account;
  const accountMetrics = resolvePortfolioAccountMetrics(portfolioStats, account, convertAccountValue);
  const accountFreshness = formatAccountFreshness(account);
  const totalMarketValue = resolvePortfolioMarketValue(portfolioStats, account, convertAccountValue);

  if (account?.netLiquidation != null) {
    rows.push({
      id: "net-liquidation",
      label: "Net Liq",
      value: formatCompact(convertAccountValue(account.netLiquidation)),
      color: colors.text,
    });
  }

  rows.push({
    id: "total-value",
    label: "Val",
    value: formatCompact(totalMarketValue),
    color: colors.text,
  });

  const marginLeverage = formatMarginLeverage(account?.netLiquidation, totalMarketValue);
  if (marginLeverage) {
    rows.push({
      id: "margin-leverage",
      label: "Margin Lev",
      value: marginLeverage,
      color: colors.text,
    });
  }

  if (account?.totalCashValue != null) {
    rows.push({
      id: "cash",
      label: "Cash",
      value: formatCompact(convertAccountValue(account.totalCashValue)),
      color: colors.text,
    });
  }

  rows.push({
    id: "day-pnl",
    label: "Day",
    value: formatSignedCompact(accountMetrics.dailyPnl),
    detail: `(${formatPercentRaw(accountMetrics.dailyPnlPct)})`,
    color: priceColor(accountMetrics.dailyPnl),
  });
  rows.push({
    id: "pnl",
    label: "P&L",
    value: formatSignedCompact(accountMetrics.unrealizedPnl),
    detail: `(${formatPercentRaw(accountMetrics.unrealizedPnlPct)})`,
    color: priceColor(accountMetrics.unrealizedPnl),
  });
  if (accountMetrics.realizedPnl != null) {
    rows.push({
      id: "realized-pnl",
      label: "Realized",
      value: formatSignedCompact(accountMetrics.realizedPnl),
      color: priceColor(accountMetrics.realizedPnl),
    });
  }

  const latestPerformancePoint = brokerPerformance?.points.at(-1);
  if (latestPerformancePoint?.cumulativeReturn != null) {
    rows.push({
      id: "historical-return",
      label: "Hist Ret",
      value: formatReturn(latestPerformancePoint.cumulativeReturn),
      detail: brokerPerformance?.period,
      color: priceColor(latestPerformancePoint.cumulativeReturn),
    });
  }

  if (account?.settledCash != null) {
    rows.push({
      id: "settled-cash",
      label: "Settled",
      value: formatCompact(account.settledCash),
      color: colors.text,
    });
  }
  if (account?.availableFunds != null) {
    rows.push({
      id: "available-funds",
      label: "Avail",
      value: formatCompact(account.availableFunds),
      color: colors.text,
    });
  }
  if (account?.excessLiquidity != null) {
    rows.push({
      id: "excess-liquidity",
      label: "Excess",
      value: formatCompact(account.excessLiquidity),
      color: colors.text,
    });
  }
  if (account?.buyingPower != null) {
    rows.push({
      id: "buying-power",
      label: "BP",
      value: formatCompact(account.buyingPower),
      color: colors.text,
    });
  }
  if (accountState) {
    if (accountFreshness) {
      rows.push({
        id: "account-freshness",
        label: "As Of",
        value: accountFreshness,
        color: colors.textDim,
      });
    }
    rows.push({
      id: "account-source",
      label: "Source",
      value: accountState.sourceLabel,
      color: colors.textDim,
    });
  }

  return rows;
}

export function buildAnalyticsRiskRows({
  sharpe,
  beta,
  indicative = false,
}: {
  sharpe: number | null;
  beta: number | null;
  indicative?: boolean;
}): AnalyticsMetricRow[] {
  const indicativeDetail = indicative ? "indicative" : null;
  return [
    sharpe !== null
      ? {
        id: "sharpe",
        label: "Sharpe Ratio",
        value: formatNumber(sharpe, 2),
        detail: [sharpeLabel(sharpe), indicativeDetail].filter(Boolean).join(" · "),
        color: sharpeColor(sharpe),
      }
      : {
        id: "sharpe",
        label: "Sharpe Ratio",
        value: "—",
        detail: indicativeDetail ?? "insufficient data",
        color: colors.textMuted,
      },
    beta !== null
      ? {
        id: "beta",
        label: "Beta (SPY)",
        value: formatNumber(beta, 2),
        detail: [betaLabel(beta), indicativeDetail].filter(Boolean).join(" · "),
        color: betaColor(beta),
      }
      : {
        id: "beta",
        label: "Beta (SPY)",
        value: "—",
        detail: indicativeDetail ?? "insufficient data",
        color: colors.textMuted,
      },
  ];
}

export function resolvePerformancePalette(
  performance: BrokerPortfolioPerformance | null,
): ReturnType<typeof resolveChartPalette> {
  const points = performance?.points ?? [];
  const first = points.find((point) => performancePointValue(point) != null);
  const last = [...points].reverse().find((point) => performancePointValue(point) != null);
  const firstValue = first ? performancePointValue(first) : null;
  const lastValue = last ? performancePointValue(last) : null;
  return resolveChartPalette(colors, firstValue != null && lastValue != null && lastValue < firstValue ? "negative" : "positive");
}

export function buildHistoryAxisLabel({
  performance,
  activePortfolio,
  baseCurrency,
}: {
  performance: BrokerPortfolioPerformance | null;
  activePortfolio: Portfolio | null;
  baseCurrency: string;
}): string {
  return performance?.points.some((point) => point.value != null)
    ? `Value (${performance.currency ?? activePortfolio?.currency ?? baseCurrency})`
    : "Return";
}

export function formatHistoryAxisValue(
  value: number,
  performance: BrokerPortfolioPerformance | null,
): string {
  return performance?.points.some((point) => point.value != null)
    ? formatCompact(value)
    : `${(value * 100).toFixed(1)}%`;
}

/** Factor proxy ETFs used to decompose portfolio risk. */
export interface FactorProxy {
  factor: string;
  symbol: string;
}

export const FACTOR_PROXIES: readonly FactorProxy[] = [
  { factor: "market", symbol: "SPY" },
  { factor: "size", symbol: "IJR" },
  { factor: "value", symbol: "VTV" },
  { factor: "momentum", symbol: "MTUM" },
] as const;

/** Chart requests for the factor proxy ETFs (1Y range). */
export function buildFactorProxyRequests(): ChartRequest[] {
  return FACTOR_PROXIES.map(({ symbol }) => ({
    instrument: { symbol, exchange: "" },
    bufferRange: "1Y" as const,
    granularity: "range" as const,
  }));
}

/** Build aligned dated-return series for each factor proxy from chart entries. */
export function buildFactorReturnSeries(
  requests: readonly ChartRequest[],
  chartEntries: ChartEntryLookup,
): FactorReturnSeries[] {
  return requests.flatMap((request) => {
    const symbol = request.instrument.symbol;
    const factor = FACTOR_PROXIES.find((proxy) => proxy.symbol === symbol)?.factor;
    if (!factor) return [];
    const entry = chartEntries.get(buildChartKey(request));
    const history = entry?.data ?? entry?.lastGoodData ?? null;
    if (!history || history.length < 11) return [];
    const returns = computeDatedReturns(history);
    if (returns.length < 10) return [];
    return [{ factor, returns }];
  });
}

/**
 * Per-position contributor inputs: market value (from portfolio columns) plus the
 * position's total return over the lookback window, computed from its price
 * history. Positions without chart history still contribute by size only.
 */
export function buildPositionContributorInputs(
  chartTargets: readonly PortfolioChartTarget[],
  chartEntries: ChartEntryLookup,
  financials: Map<string, TickerFinancials>,
  columnContext: ColumnContext,
  options?: { equalWeight?: boolean },
): ContributorInput[] {
  const inputs: ContributorInput[] = [];
  const equalShare = chartTargets.length > 0 ? 1 / chartTargets.length : 0;
  for (const { ticker, request } of chartTargets) {
    const symbol = ticker.metadata.ticker;
    const financialsEntry = financials.get(symbol);
    const marketValue = options?.equalWeight
      ? equalShare
      : getPortfolioPositionValue(ticker, financialsEntry, columnContext);
    if (marketValue == null) continue;

    const entry = chartEntries.get(buildChartKey(request));
    const history = entry?.data ?? entry?.lastGoodData ?? null;
    let returnPct: number | null = null;
    if (history && history.length >= 2) {
      const sorted = [...history]
        .filter((point) => Number.isFinite(point.close) && point.close > 0)
        .sort((left, right) => {
          const lt = left.date instanceof Date ? left.date.getTime() : new Date(left.date).getTime();
          const rt = right.date instanceof Date ? right.date.getTime() : new Date(right.date).getTime();
          return lt - rt;
        });
      if (sorted.length >= 2) {
        const first = sorted[0]!.close;
        const last = sorted.at(-1)!.close;
        if (first > 0) {
          returnPct = (last - first) / first;
        }
      }
    }

    inputs.push({
      symbol,
      name: ticker.metadata.name || symbol,
      sector: ticker.metadata.sector || financialsEntry?.profile?.sector || "Unknown",
      marketValue,
      returnPct,
    });
  }
  return inputs;
}

/** Format a 1-day VaR dollar loss compactly. */
export function formatVaR(value: number | null): string {
  return value == null ? "—" : formatCompact(value);
}
