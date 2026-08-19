import { useEffect, useMemo, useState } from "react";
import {
  buildTickerSearchCandidates,
  searchTickerCandidates,
} from "../../../tickers/search";
import { useOptionalAppSelector } from "../../../state/app/context";
import type { TickerRecord } from "../../../types/ticker";
import { getSharedRegistry } from "../../registry";
import { loadKalshiCatalog } from "../../prediction-markets/services/kalshi/adapter";
import { loadPolymarketCatalog } from "../../prediction-markets/services/polymarket/adapter";
import type { PredictionMarketSummary } from "../../prediction-markets/types";
import {
  analyzeSeriesSearchQuery,
  buildSeriesCatalogSuggestions,
  type SeriesCatalogInstrument,
  type SeriesCatalogSuggestion,
} from "./series-catalog";
import {
  looksLikePredictionMarketQuery,
  type PredictionMarketSearchHit,
} from "./prediction-series";

const EMPTY_TICKERS: ReadonlyMap<string, TickerRecord> = new Map();
const EMPTY_RECENT: readonly string[] = [];
const DEFAULT_CATALOG_INSTRUMENTS: readonly SeriesCatalogInstrument[] = [
  { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." },
  { symbol: "MSFT", exchange: "NASDAQ", name: "Microsoft Corporation" },
  { symbol: "GOOGL", exchange: "NASDAQ", name: "Alphabet Inc." },
  { symbol: "AMZN", exchange: "NASDAQ", name: "Amazon.com Inc." },
  { symbol: "NVDA", exchange: "NASDAQ", name: "NVIDIA Corporation" },
  { symbol: "TSLA", exchange: "NASDAQ", name: "Tesla Inc." },
  { symbol: "META", exchange: "NASDAQ", name: "Meta Platforms Inc." },
  { symbol: "BRK.B", exchange: "NYSE", name: "Berkshire Hathaway Inc." },
  { symbol: "JPM", exchange: "NYSE", name: "JPMorgan Chase & Co." },
  { symbol: "V", exchange: "NYSE", name: "Visa Inc." },
  { symbol: "BTC-USD", exchange: "CCC", name: "Bitcoin USD" },
  { symbol: "ETH-USD", exchange: "CCC", name: "Ethereum USD" },
];

function instrumentFromTicker(ticker: TickerRecord): SeriesCatalogInstrument {
  return {
    symbol: ticker.metadata.ticker,
    ...(ticker.metadata.exchange ? { exchange: ticker.metadata.exchange } : {}),
    ...(ticker.metadata.name ? { name: ticker.metadata.name } : {}),
    ...(ticker.metadata.assetCategory ? { assetCategory: ticker.metadata.assetCategory } : {}),
  };
}

function uniqueCatalogInstruments(
  instruments: readonly SeriesCatalogInstrument[],
): SeriesCatalogInstrument[] {
  const seen = new Set<string>();
  return instruments.filter((instrument) => {
    const key = `${instrument.symbol}:${instrument.exchange ?? ""}:${instrument.assetCategory ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateToInstrument(candidate: {
  symbol: string;
  ticker?: TickerRecord;
  result?: { primaryExchange?: string; exchange?: string; name?: string; type?: string };
}): SeriesCatalogInstrument {
  const exchange = candidate.ticker?.metadata.exchange
    || candidate.result?.primaryExchange
    || candidate.result?.exchange;
  const name = candidate.ticker?.metadata.name || candidate.result?.name;
  const assetCategory = candidate.ticker?.metadata.assetCategory || candidate.result?.type;
  return {
    symbol: candidate.symbol,
    ...(exchange ? { exchange } : {}),
    ...(name ? { name } : {}),
    ...(assetCategory ? { assetCategory } : {}),
  };
}

/** Watchlist + option-aware ticker search used by the Data Catalog universe. */
export function useCatalogUniverse(query: string): {
  instruments: SeriesCatalogInstrument[];
  loading: boolean;
} {
  const tickers = useOptionalAppSelector((state) => state.tickers, EMPTY_TICKERS);
  const recentSymbols = useOptionalAppSelector((state) => state.recentTickers, EMPTY_RECENT);
  const watchlist = useMemo(
    () => [...tickers.values()].map(instrumentFromTicker),
    [tickers],
  );
  const recents = useMemo(
    () => recentSymbols.flatMap((symbol) => {
      const ticker = tickers.get(symbol);
      if (ticker) return [instrumentFromTicker(ticker)];
      const trimmed = symbol.trim();
      return trimmed ? [{ symbol: trimmed }] : [];
    }),
    [recentSymbols, tickers],
  );
  const [search, setSearch] = useState<{
    query: string;
    instruments: SeriesCatalogInstrument[];
    loading: boolean;
  }>({ query: "", instruments: [], loading: false });

  useEffect(() => {
    const instrumentQuery = query.trim();
    if (!instrumentQuery || instrumentQuery.includes(":")) {
      setSearch({ query: "", instruments: [], loading: false });
      return;
    }

    const applyLocal = () => {
      const candidates = buildTickerSearchCandidates({
        query: instrumentQuery,
        tickers,
        providerResults: [],
        totalLimit: 12,
        localLimit: 8,
        includeOptionContracts: true,
      });
      setSearch({
        query: instrumentQuery,
        instruments: candidates.map(candidateToInstrument),
        loading: false,
      });
    };

    const registry = getSharedRegistry();
    if (!registry) {
      applyLocal();
      return;
    }

    let cancelled = false;
    setSearch({ query: instrumentQuery, instruments: [], loading: true });
    const timer = setTimeout(() => {
      void searchTickerCandidates({
        query: instrumentQuery,
        tickers,
        dataProvider: registry.marketData,
        totalLimit: 12,
        localLimit: 8,
        includeOptionContracts: true,
      }).then((candidates) => {
        if (cancelled) return;
        setSearch({
          query: instrumentQuery,
          instruments: candidates.map(candidateToInstrument),
          loading: false,
        });
      }).catch(() => {
        if (!cancelled) applyLocal();
      });
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tickers]);

  const searched = search.query === query.trim() ? search.instruments : [];
  const instruments = useMemo(() => {
    const merged = uniqueCatalogInstruments([...watchlist, ...recents, ...searched]);
    return merged.length > 0 ? merged : [...DEFAULT_CATALOG_INSTRUMENTS];
  }, [recents, searched, watchlist]);

  return {
    instruments,
    loading: search.loading && search.query === query.trim(),
  };
}

function hitsFromVenueSummaries(
  summaries: readonly PredictionMarketSummary[],
): PredictionMarketSearchHit[] {
  return summaries.flatMap((summary) => {
    const marketId = summary.marketId.trim();
    if (!marketId) return [];
    return [{
      venue: summary.venue,
      marketId,
      title: summary.title.trim() || summary.marketLabel.trim() || marketId,
      ...(summary.eventLabel.trim() ? { eventLabel: summary.eventLabel } : {}),
      ...(summary.marketLabel.trim() ? { marketLabel: summary.marketLabel } : {}),
      ...(summary.url.trim() ? { url: summary.url } : {}),
    }];
  });
}

let catalogPredictionHitsCache: PredictionMarketSearchHit[] | null = null;
let catalogPredictionHitsInflight: Promise<PredictionMarketSearchHit[]> | null = null;

export function resetCatalogPredictionHitsCache(): void {
  catalogPredictionHitsCache = null;
  catalogPredictionHitsInflight = null;
}

export function loadCatalogPredictionHits(): Promise<PredictionMarketSearchHit[]> {
  if (catalogPredictionHitsCache) return Promise.resolve(catalogPredictionHitsCache);
  if (catalogPredictionHitsInflight) return catalogPredictionHitsInflight;
  catalogPredictionHitsInflight = Promise.allSettled([
    loadKalshiCatalog("", "all", "top"),
    loadPolymarketCatalog("", "all", "top"),
  ]).then((results) => {
    const markets = results.flatMap((result) => (
      result.status === "fulfilled" ? hitsFromVenueSummaries(result.value) : []
    ));
    if (markets.length > 0) catalogPredictionHitsCache = markets;
    return markets;
  }).finally(() => {
    catalogPredictionHitsInflight = null;
  });
  return catalogPredictionHitsInflight;
}

export function usePredictionMarketHits(
  enabled: boolean,
): { markets: PredictionMarketSearchHit[]; loading: boolean } {
  const [markets, setMarkets] = useState<PredictionMarketSearchHit[]>(
    catalogPredictionHitsCache ?? [],
  );
  const [loading, setLoading] = useState(enabled && catalogPredictionHitsCache == null);

  useEffect(() => {
    if (!enabled) return;
    if (catalogPredictionHitsCache) {
      setMarkets(catalogPredictionHitsCache);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void loadCatalogPredictionHits().then((hits) => {
      if (cancelled) return;
      setMarkets(hits);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { markets, loading };
}

export interface SeriesCatalogSearchResult {
  suggestions: SeriesCatalogSuggestion[];
  instruments: SeriesCatalogInstrument[];
  loading: boolean;
}

/** Shared smart-series search used by both inline quick-add and the full editor. */
export function useSeriesCatalogSuggestions({
  query,
  defaultInstrument,
  enabled,
}: {
  query: string;
  defaultInstrument: SeriesCatalogInstrument;
  enabled: boolean;
}): SeriesCatalogSearchResult {
  const tickers = useOptionalAppSelector((state) => state.tickers, EMPTY_TICKERS);
  const analysis = useMemo(() => analyzeSeriesSearchQuery(query), [query]);
  const [search, setSearch] = useState<{
    query: string;
    instruments: SeriesCatalogInstrument[];
    loading: boolean;
  }>({ query: "", instruments: [], loading: false });
  const predictionSearch = usePredictionMarketHits(
    enabled && looksLikePredictionMarketQuery(query.trim()),
  );

  useEffect(() => {
    const instrumentQuery = analysis.instrumentQuery.trim();
    if (!enabled || !instrumentQuery || analysis.directInstrument || looksLikePredictionMarketQuery(query)) {
      setSearch({ query: "", instruments: [], loading: false });
      return;
    }

    const registry = getSharedRegistry();
    if (!registry) {
      // The registry is installed after the app state is created in some
      // hosted/test render paths. Local tickers are still enough to resolve
      // a company name, so do not leave the catalog permanently empty while
      // waiting for the provider registry.
      const candidates = buildTickerSearchCandidates({
        query: instrumentQuery,
        tickers,
        providerResults: [],
        totalLimit: 4,
        localLimit: 3,
        includeOptionContracts: false,
      });
      setSearch({
        query: instrumentQuery,
        instruments: candidates.map((candidate) => ({
          symbol: candidate.symbol,
          ...(candidate.ticker?.metadata.exchange
            ? { exchange: candidate.ticker.metadata.exchange }
            : {}),
          ...(candidate.ticker?.metadata.name
            ? { name: candidate.ticker.metadata.name }
            : {}),
        })),
        loading: false,
      });
      return;
    }

    let cancelled = false;
    setSearch({ query: instrumentQuery, instruments: [], loading: true });
    const timer = setTimeout(() => {
      void searchTickerCandidates({
        query: instrumentQuery,
        tickers,
        dataProvider: registry.marketData,
        totalLimit: 4,
        localLimit: 3,
        includeOptionContracts: false,
      }).then((candidates) => {
        if (cancelled) return;
        setSearch({
          query: instrumentQuery,
          instruments: candidates.map((candidate) => ({
            symbol: candidate.symbol,
            ...(candidate.ticker?.metadata.exchange
              ? { exchange: candidate.ticker.metadata.exchange }
              : candidate.result?.primaryExchange || candidate.result?.exchange
                ? { exchange: candidate.result?.primaryExchange || candidate.result?.exchange }
                : {}),
            ...(candidate.ticker?.metadata.name || candidate.result?.name
              ? { name: candidate.ticker?.metadata.name || candidate.result?.name }
              : {}),
          })),
          loading: false,
        });
      }).catch(() => {
        if (!cancelled) setSearch({ query: instrumentQuery, instruments: [], loading: false });
      });
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [analysis.directInstrument, analysis.instrumentQuery, enabled, query, tickers]);

  const instruments = search.query === analysis.instrumentQuery
    ? search.instruments
    : [];
  const markets = predictionSearch.markets;
  const suggestions = useMemo(
    () => buildSeriesCatalogSuggestions(query, defaultInstrument, instruments, 8, markets),
    [defaultInstrument, instruments, markets, query],
  );

  return {
    suggestions,
    instruments,
    loading: (search.loading && search.query === analysis.instrumentQuery)
      || predictionSearch.loading,
  };
}
