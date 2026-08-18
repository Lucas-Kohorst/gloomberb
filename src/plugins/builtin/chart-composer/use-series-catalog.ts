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
    if (!enabled || !trimmed || trimmed.includes(":")) {
      setSearch({ query: "", markets: [], loading: false });
      return;
    }

    let cancelled = false;
    setSearch({ query: trimmed, markets: [], loading: true });
    const timer = setTimeout(() => {
      void getSharedAdjacentClient().searchMarkets(trimmed, 12).then((response) => {
        if (cancelled) return;
        const markets = (response.markets ?? []).flatMap((market) => {
          const hit = mapAdjacentMarketToHit(market);
          return hit ? [hit] : [];
        });
        setSearch({ query: trimmed, markets, loading: false });
      }).catch(() => {
        if (!cancelled) setSearch({ query: trimmed, markets: [], loading: false });
      });
    }, 120);

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
