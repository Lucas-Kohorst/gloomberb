import { useEffect, useMemo, useState } from "react";
import {
  buildTickerSearchCandidates,
  searchTickerCandidates,
} from "../../../tickers/search";
import { useOptionalAppSelector } from "../../../state/app/context";
import type { TickerRecord } from "../../../types/ticker";
import { getSharedRegistry } from "../../registry";
import { getSharedAdjacentClient } from "../adjacent/client";
import {
  analyzeSeriesSearchQuery,
  buildSeriesCatalogSuggestions,
  type SeriesCatalogInstrument,
  type SeriesCatalogSuggestion,
} from "./series-catalog";
import {
  looksLikePredictionMarketQuery,
  mapAdjacentMarketToHit,
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

export function usePredictionMarketHits(
  query: string,
  enabled: boolean,
): { markets: PredictionMarketSearchHit[]; loading: boolean } {
  const trimmed = query.trim();
  const [search, setSearch] = useState<{
    query: string;
    markets: PredictionMarketSearchHit[];
    loading: boolean;
  }>({ query: "", markets: [], loading: false });

  useEffect(() => {
    if (!enabled || trimmed.includes(":")) {
      setSearch({ query: "", markets: [], loading: false });
      return;
    }

    let cancelled = false;
    setSearch({ query: trimmed, markets: [], loading: true });
    const timer = setTimeout(() => {
      const client = getSharedAdjacentClient();
      const request = trimmed.length >= 3
        ? client.searchMarkets(trimmed, 24)
        : Promise.all([
          client.getMarkets({ platform: "kalshi", limit: 24 }),
          client.getMarkets({ platform: "polymarket", limit: 24 }),
        ]).then(([kalshi, polymarket]) => ({
          markets: [...(kalshi.markets ?? []), ...(polymarket.markets ?? [])],
        }));
      void request.then((response) => {
        if (cancelled) return;
        const markets = (response.markets ?? []).flatMap((market) => {
          const hit = mapAdjacentMarketToHit(market);
          return hit ? [hit] : [];
        });
        setSearch({ query: trimmed, markets, loading: false });
      }).catch(() => {
        if (!cancelled) setSearch({ query: trimmed, markets: [], loading: false });
      });
    }, trimmed.length >= 3 ? 120 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, trimmed]);

  return {
    markets: search.query === trimmed ? search.markets : [],
    loading: search.loading && search.query === trimmed,
  };
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
    query,
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
