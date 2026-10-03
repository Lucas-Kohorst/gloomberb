import { createChartSeriesResolver } from "../../../capabilities";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { searchTickerCandidates, type TickerSearchCandidate } from "../../../tickers/search";
import { createResolvedChartSources } from "../../chart-sources";
import type { PluginRegistry } from "../../registry";
import { localCatalogSuggestions, searchRegisteredCatalogs } from "./catalog-providers";
import { getSharedAdjacentClient } from "../adjacent/client";
import { looksLikePredictionMarketQuery, venueChartHitFromAdjacentMarket } from "./prediction-series";
import { buildSeriesSpec, parseSeriesExpression } from "./presets";
import { createSearchableLibraryFeed, libraryInstrument, type LibraryInstrument } from "./charting-library-search";
import type { LibraryDatafeed } from "./charting-library-feed";

function candidateInstrument(candidate: TickerSearchCandidate): LibraryInstrument | null {
  const result = candidate.result;
  const instrument = result ? {
    symbol: result.symbol,
    exchange: result.exchange || result.primaryExchange,
    brokerId: result.brokerContract?.brokerId,
    brokerInstanceId: result.brokerInstanceId,
    instrument: result.brokerContract,
  } : instrumentFromTicker(candidate.ticker, candidate.symbol);
  if (!instrument) return null;
  const name = result?.name || candidate.ticker?.metadata.name || candidate.symbol;
  const venue = instrument.exchange?.toLowerCase();
  if (candidate.instrumentClass === "prediction" && (venue === "kalshi" || venue === "polymarket")) {
    return libraryInstrument({ kind: "prediction-market", venue, marketId: instrument.symbol }, name, "index");
  }
  const type = candidate.instrumentClass === "future" ? "futures"
    : candidate.instrumentClass === "index" ? "index"
    : candidate.instrumentClass === "currency" ? "forex"
    : candidate.instrumentClass === "option" ? "option"
    : /crypto/i.test(result?.type ?? candidate.ticker?.metadata.assetCategory ?? "") ? "crypto" : "stock";
  return libraryInstrument({ kind: "security", instrument, fieldId: "market.ohlcv" }, name, type);
}

export function createRegisteredLibraryFeed(base: LibraryDatafeed, registry: PluginRegistry) {
  const sources = createResolvedChartSources(registry.getMarketData(), createChartSeriesResolver(registry));
  return createSearchableLibraryFeed({
    base,
    getSources: () => sources,
    read: (ticker) => registry.getConfigState<LibraryInstrument>("chart-composer", `library-source:${ticker}`),
    remember: (item) => {
      const key = `library-source:${item.ticker}`;
      if (JSON.stringify(registry.getConfigState("chart-composer", key)) === JSON.stringify(item)) return;
      void registry.setConfigState("chart-composer", key, item).catch((error: unknown) => {
        registry.notify({ body: `Could not save chart instrument: ${error instanceof Error ? error.message : String(error)}`, type: "error" });
      });
    },
    search: async (query, signal) => {
      const tickers = await registry.tickerRepository.loadAllTickers();
      signal.throwIfAborted();
      const catalogs = registry.getAvailableChartSeriesCatalogs();
      const [instruments, remoteSeries, predictionMarkets] = await Promise.allSettled([
        searchTickerCandidates({ query, tickers: new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker])), dataProvider: registry.getMarketData(), searchContext: { preferBroker: true, interactive: true }, localLimit: 20, totalLimit: 40 }),
        searchRegisteredCatalogs(query, catalogs, signal),
        looksLikePredictionMarketQuery(query) && !query.includes(":")
          ? getSharedAdjacentClient().searchMarkets(query, 12) : Promise.resolve({ markets: [] }),
      ]);
      signal.throwIfAborted();
      const rows = instruments.status === "fulfilled" ? instruments.value.flatMap((candidate) => {
        const item = candidateInstrument(candidate);
        return item ? [item] : [];
      }) : [];
      const series = [...localCatalogSuggestions(query, catalogs, 20), ...(remoteSeries.status === "fulfilled" ? remoteSeries.value : [])];
      for (const entry of series) {
        const item = libraryInstrument(buildSeriesSpec(entry.expression, 0).source, entry.label, "index");
        if (item) rows.push(item);
      }
      for (const market of predictionMarkets.status === "fulfilled" ? predictionMarkets.value.markets ?? [] : []) {
        const hit = venueChartHitFromAdjacentMarket(market);
        if (!hit) continue;
        const item = libraryInstrument({ kind: "prediction-market", venue: hit.venue, marketId: hit.marketId }, hit.title, "index");
        if (item) rows.push(item);
      }
      const expression = query.includes(":") ? parseSeriesExpression(query) : null;
      if (expression) {
        const item = libraryInstrument(buildSeriesSpec(expression, 0).source, query, expression.kind === "security" ? "stock" : "index");
        if (item) rows.push(item);
      }
      return rows;
    },
  });
}
