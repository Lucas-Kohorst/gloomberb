import { useCallback, useEffect, useRef, useState } from "react";
import type { Quote } from "../../../types/financials";
import { useAssetData } from "../../runtime";

interface BoardQuoteState {
  quote: Quote | null;
  loading: boolean;
  error: string | null;
}

export type BoardQuoteMap = Map<string, BoardQuoteState>;

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Polls a fixed set of symbols for a quote board (world indices, futures).
 *
 * Boards differ only in which symbols they watch, so the batch/serial fallback
 * and the stale-response guard live here rather than in each pane. `symbols`
 * must be a stable reference; these boards are built from module-level
 * catalogs, so that is free.
 */
export function useQuoteBoard(symbols: string[], refreshIntervalMs: number): {
  quotes: BoardQuoteMap;
  refresh: () => void;
} {
  const dataProvider = useAssetData();
  const [quotes, setQuotes] = useState<BoardQuoteMap>(new Map());
  // Responses can land out of order after a manual refresh, so only the newest
  // request is allowed to write.
  const fetchGenRef = useRef(0);

  const refresh = useCallback(() => {
    if (!dataProvider) return;

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;

    setQuotes((prev) => {
      const next = new Map(prev);
      for (const symbol of symbols) {
        next.set(symbol, { quote: prev.get(symbol)?.quote ?? null, loading: true, error: null });
      }
      return next;
    });

    const loadQuotes = async (): Promise<BoardQuoteMap> => {
      const next: BoardQuoteMap = new Map();
      if (dataProvider.getQuotesBatch) {
        const results = await dataProvider.getQuotesBatch(
          symbols.map((symbol) => ({ symbol, exchange: "" })),
        );
        const bySymbol = new Map(results.map((result) => [result.target.symbol, result]));
        for (const symbol of symbols) {
          const result = bySymbol.get(symbol);
          next.set(symbol, {
            quote: result?.quote ?? null,
            loading: false,
            error: result?.error ? errorMessage(result.error) : null,
          });
        }
        return next;
      }

      await Promise.all(symbols.map(async (symbol) => {
        try {
          next.set(symbol, { quote: await dataProvider.getQuote(symbol, ""), loading: false, error: null });
        } catch (error: unknown) {
          next.set(symbol, { quote: null, loading: false, error: errorMessage(error) });
        }
      }));
      return next;
    };

    loadQuotes().then((loaded) => {
      if (fetchGenRef.current !== gen) return;
      setQuotes((prev) => {
        const next = new Map(prev);
        for (const [symbol, state] of loaded) next.set(symbol, state);
        return next;
      });
    }).catch((error: unknown) => {
      if (fetchGenRef.current !== gen) return;
      const message = errorMessage(error);
      setQuotes((prev) => {
        const next = new Map(prev);
        for (const symbol of symbols) next.set(symbol, { quote: null, loading: false, error: message });
        return next;
      });
    });
  }, [dataProvider, symbols]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, refreshIntervalMs]);

  return { quotes, refresh };
}

export function countLoadingQuotes(quotes: BoardQuoteMap): number {
  return Array.from(quotes.values()).filter((state) => state.loading).length;
}

export function countFailedQuotes(quotes: BoardQuoteMap): number {
  return Array.from(quotes.values()).filter((state) => state.error !== null).length;
}

export function latestQuoteTimestamp(quotes: BoardQuoteMap): number {
  return Math.max(0, ...Array.from(quotes.values()).map((state) => state.quote?.lastUpdated ?? 0));
}
