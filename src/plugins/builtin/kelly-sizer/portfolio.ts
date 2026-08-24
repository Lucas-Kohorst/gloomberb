import type { AppConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { getActiveQuoteDisplay } from "../../../market-data/market/status";
import { convertCurrency } from "../../../utils/format";
import { resolveAnalyticsCollection } from "../analytics/portfolio-selection";
import { getPortfolioPositionMetrics, resolveBrokerFallbackMarketValue } from "../portfolio-list/position-metrics";

export function getPortfolioPositionValue({
  ticker,
  financials,
  portfolioId,
  baseCurrency,
  exchangeRates,
}: {
  ticker: TickerRecord | null;
  financials: TickerFinancials | null;
  portfolioId: string | null;
  baseCurrency: string;
  exchangeRates: Map<string, number>;
}): number {
  if (!ticker) return 0;
  const scopedTicker: TickerRecord = portfolioId
    ? {
        ...ticker,
        metadata: {
          ...ticker.metadata,
          positions: ticker.metadata.positions.filter((position) => position.portfolio === portfolioId),
        },
      }
    : ticker;
  const quote = financials?.quote;
  const activeQuote = getActiveQuoteDisplay(quote);
  const quoteCurrency = quote?.currency || ticker.metadata.currency || baseCurrency;
  const metrics = getPortfolioPositionMetrics(scopedTicker, undefined, quoteCurrency);

  if (activeQuote && metrics.totalPriceUnits !== 0) {
    return convertCurrency(Math.abs(metrics.totalPriceUnits) * activeQuote.price, quoteCurrency, baseCurrency, exchangeRates);
  }

  const brokerFallback = resolveBrokerFallbackMarketValue(metrics);
  const positionCurrency = metrics.positionCurrency || quoteCurrency;
  return convertCurrency(Math.abs(brokerFallback ?? metrics.totalCost), positionCurrency, baseCurrency, exchangeRates);
}

export function resolveActivePortfolioId({
  requestedPortfolioId,
  activeCollectionId,
  symbol,
  ticker,
  config,
}: {
  requestedPortfolioId?: string | null;
  activeCollectionId: string | null;
  symbol: string | null;
  ticker: TickerRecord | null;
  config: AppConfig;
}): string | null {
  if (requestedPortfolioId && resolveAnalyticsCollection(config, requestedPortfolioId)) {
    return requestedPortfolioId;
  }
  if (activeCollectionId && resolveAnalyticsCollection(config, activeCollectionId)) {
    return activeCollectionId;
  }
  if (ticker) {
    const positionPortfolio = ticker.metadata.positions.find((position) => position.portfolio)?.portfolio;
    if (positionPortfolio) return positionPortfolio;
    if (ticker.metadata.portfolios[0]) return ticker.metadata.portfolios[0];
    if (ticker.metadata.watchlists[0]) return ticker.metadata.watchlists[0];
  }
  return symbol
    ? config.portfolios[0]?.id ?? config.watchlists[0]?.id ?? null
    : null;
}
