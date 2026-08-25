import type { TickerFinancials } from "../../../../types/financials";
import type { TickerRecord } from "../../../../types/ticker";
import { convertCurrency } from "../../../../utils/format";
import { getActiveQuoteDisplay } from "../../../../market-data/market/status";
import { getPortfolioPositionMetrics, resolveBrokerFallbackMarketValue } from "../position-metrics";

export interface PortfolioSummaryTotals {
  totalMktValue: number;
  dailyPnl: number;
  dailyPnlPct: number;
  totalCostBasis: number;
  hasPositions: boolean;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  avgWatchlistChange: number;
  watchlistCount: number;
}

export function calculatePortfolioSummaryTotals(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  baseCurrency: string,
  exchangeRates: Map<string, number>,
  isPortfolio: boolean,
  collectionId: string | null,
): PortfolioSummaryTotals {
  let totalMktValue = 0;
  let totalPrevValue = 0;
  let totalCostBasis = 0;
  let dailyPnl = 0;
  let unrealizedPnl = 0;
  let hasPositions = false;
  let watchlistChangeSum = 0;
  let watchlistCount = 0;

  for (const ticker of tickers) {
    const financials = financialsMap.get(ticker.metadata.ticker);
    const quote = financials?.quote;
    const activeQuote = getActiveQuoteDisplay(quote);
    const quoteCurrency = quote?.currency || ticker.metadata.currency || "USD";

    if (!isPortfolio) {
      if (quote?.changePercent != null) {
        watchlistChangeSum += quote.changePercent;
        watchlistCount++;
      }
      continue;
    }

    const positionMetrics = getPortfolioPositionMetrics(ticker, collectionId ?? undefined, quoteCurrency);
    const { positionCurrency, totalPriceUnits, totalCost } = positionMetrics;
    const brokerFallbackMktValue = resolveBrokerFallbackMarketValue(positionMetrics);
    const toBaseQuote = (value: number) => convertCurrency(value, quoteCurrency, baseCurrency, exchangeRates);
    const toBasePosition = (value: number) => convertCurrency(value, positionCurrency, baseCurrency, exchangeRates);

    if (quote && activeQuote && totalPriceUnits !== 0) {
      hasPositions = true;
      const direction = totalPriceUnits >= 0 ? 1 : -1;
      const marketValue = Math.abs(totalPriceUnits) * activeQuote.price;
      const baseMarketValue = toBaseQuote(marketValue);
      totalMktValue += baseMarketValue;
      const previousClose = quote.previousClose || (activeQuote.price - activeQuote.change);
      const basePrevValue = toBaseQuote(Math.abs(totalPriceUnits) * previousClose);
      totalPrevValue += basePrevValue;
      const baseCostBasis = toBasePosition(totalCost);
      totalCostBasis += baseCostBasis;
      dailyPnl += direction * (baseMarketValue - basePrevValue);
      unrealizedPnl += direction * (baseMarketValue - baseCostBasis);
    } else if (brokerFallbackMktValue != null) {
      hasPositions = true;
      const baseBrokerMktValue = toBasePosition(brokerFallbackMktValue);
      const baseCostBasis = toBasePosition(totalCost);
      totalMktValue += baseBrokerMktValue;
      totalCostBasis += baseCostBasis;
      totalPrevValue += baseBrokerMktValue;
      unrealizedPnl += baseBrokerMktValue - baseCostBasis;
    }
  }

  const dailyPnlPct = totalPrevValue !== 0 ? (dailyPnl / totalPrevValue) * 100 : 0;
  const unrealizedPnlPct = totalCostBasis !== 0 ? (unrealizedPnl / totalCostBasis) * 100 : 0;
  const avgWatchlistChange = watchlistCount > 0 ? watchlistChangeSum / watchlistCount : 0;

  return {
    totalMktValue,
    dailyPnl,
    dailyPnlPct,
    totalCostBasis,
    hasPositions,
    unrealizedPnl,
    unrealizedPnlPct,
    avgWatchlistChange,
    watchlistCount,
  };
}
