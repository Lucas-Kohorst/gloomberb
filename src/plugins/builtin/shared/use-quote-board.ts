import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneFooterSegment } from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import type { MarketState, Quote } from "../../../types/financials";
import { useAssetData } from "../../runtime";
import { nextAutoRefreshDelayMs } from "./use-auto-refresh";

export interface BoardQuoteState {
  quote: Quote | null;
  loading: boolean;
  error: string | null;
  /** The quote is the last good one, kept because the newest load returned nothing. */
  stale: boolean;
}

export type BoardQuoteMap = Map<string, BoardQuoteState>;

const EMPTY_STATE: BoardQuoteState = { quote: null, loading: false, error: null, stale: false };

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * A failed refresh must not blank a board that was showing prices a second
 * ago: keep the last good quote and mark it stale instead.
 */
function mergeQuotes(previous: BoardQuoteMap, loaded: BoardQuoteMap): BoardQuoteMap {
  const next = new Map(previous);
  for (const [symbol, state] of loaded) {
    const retained = state.quote ?? previous.get(symbol)?.quote ?? null;
    next.set(symbol, {
      quote: retained,
      loading: false,
      error: state.error,
      stale: !state.quote && retained !== null,
    });
  }
  return next;
}

/**
 * Polls a fixed symbol list for a quote board (world indices, futures).
 *
 * Boards differ only in which symbols they watch, so the batch/serial fallback
 * and the stale-response guard live here instead of in each pane. `symbols`
 * must be a stable reference; boards build theirs from module-level catalogs.
 *
 * The first load may serve the provider cache, which is what makes a board
 * paint instantly on open. Every load after it is a refresh the user asked for
 * (manually or on the poll interval) and bypasses those caches.
 */
export interface QuoteBoardOptions {
  liveStreaming?: boolean;
  visibleSymbols?: ReadonlySet<string> | null;
  selectedSymbol?: string | null;
  fallbackIntervalMs?: number;
}

export function useQuoteBoard(symbols: string[], refreshOrOptions: number | QuoteBoardOptions): {
  quotes: BoardQuoteMap;
  refresh: () => void;
} {
  const refreshIntervalMs = typeof refreshOrOptions === "number"
    ? refreshOrOptions
    : refreshOrOptions.fallbackIntervalMs ?? 60_000;
  const dataProvider = useAssetData();
  const [quotes, setQuotes] = useState<BoardQuoteMap>(new Map());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // A manual refresh can land after an in-flight poll, so only the newest
  // request is allowed to write.
  const fetchGenRef = useRef(0);
  const lastUpdatedRef = useRef<number | null>(null);

  const load = useCallback((forceRefresh: boolean) => {
    if (!dataProvider) return;

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;

    setQuotes((prev) => {
      const next = new Map(prev);
      for (const symbol of symbols) {
        next.set(symbol, { ...(prev.get(symbol) ?? EMPTY_STATE), loading: true });
      }
      return next;
    });

    const loadQuotes = async (): Promise<BoardQuoteMap> => {
      const next: BoardQuoteMap = new Map();
      if (dataProvider.getQuotesBatch) {
        const results = await dataProvider.getQuotesBatch(
          symbols.map((symbol) => ({ symbol, exchange: "" })),
          { forceRefresh },
        );
        const bySymbol = new Map(results.map((result) => [result.target.symbol, result]));
        for (const symbol of symbols) {
          const result = bySymbol.get(symbol);
          next.set(symbol, {
            quote: result?.quote ?? null,
            loading: false,
            error: result?.error ? errorMessage(result.error) : null,
            stale: false,
          });
        }
        return next;
      }

      const context = forceRefresh ? { cacheMode: "refresh" as const } : undefined;
      await Promise.all(symbols.map(async (symbol) => {
        try {
          const quote = await dataProvider.getQuote(symbol, "", context);
          next.set(symbol, { quote, loading: false, error: null, stale: false });
        } catch (error: unknown) {
          next.set(symbol, { quote: null, loading: false, error: errorMessage(error), stale: false });
        }
      }));
      return next;
    };

    loadQuotes().then((loaded) => {
      if (fetchGenRef.current !== gen) return;
      setQuotes((prev) => mergeQuotes(prev, loaded));
      const stamp = Date.now();
      lastUpdatedRef.current = stamp;
      setLastUpdated(stamp);
    }).catch((error: unknown) => {
      if (fetchGenRef.current !== gen) return;
      const message = errorMessage(error);
      const failed: BoardQuoteMap = new Map(symbols.map((symbol) => [
        symbol,
        { quote: null, loading: false, error: message, stale: false },
      ]));
      setQuotes((prev) => mergeQuotes(prev, failed));
      const stamp = Date.now();
      lastUpdatedRef.current = stamp;
      setLastUpdated(stamp);
    });
  }, [dataProvider, symbols]);

  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (!(refreshIntervalMs > 0)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      const delay = nextAutoRefreshDelayMs(lastUpdatedRef.current, refreshIntervalMs);
      timer = setTimeout(tick, delay);
    };

    const tick = () => {
      if (cancelled) return;
      const previous = lastUpdatedRef.current;
      if (previous && Date.now() - previous < refreshIntervalMs) {
        schedule();
        return;
      }
      load(true);
      timer = setTimeout(tick, refreshIntervalMs);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [lastUpdated, load, refreshIntervalMs]);

  return { quotes, refresh };
}

export interface QuoteBoardStatus {
  loading: number;
  /** Symbols showing their last good quote after a failed load. */
  stale: number;
  /** Symbols with no quote to show at all. */
  unavailable: number;
  latestTs: number;
}

export function quoteBoardStatus(quotes: BoardQuoteMap): QuoteBoardStatus {
  let loading = 0;
  let stale = 0;
  let unavailable = 0;
  let latestTs = 0;
  for (const state of quotes.values()) {
    if (state.loading) loading += 1;
    if (state.stale) stale += 1;
    else if (!state.quote && !state.loading) unavailable += 1;
    latestTs = Math.max(latestTs, state.quote?.lastUpdated ?? 0);
  }
  return { loading, stale, unavailable, latestTs };
}

/** Board footer status: everything here changes as loads succeed or fail. */
export function quoteBoardFooterInfo(status: QuoteBoardStatus): PaneFooterSegment[] {
  const info: PaneFooterSegment[] = [];
  if (status.loading > 0) info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
  if (status.stale > 0) {
    info.push({ id: "stale", parts: [{ text: `${status.stale} stale`, tone: "warning" }] });
  }
  if (status.unavailable > 0) {
    info.push({ id: "error", parts: [{ text: `${status.unavailable} unavailable`, tone: "warning" }] });
  }
  if (status.latestTs > 0) {
    info.push({
      id: "fresh",
      parts: [{
        text: new Date(status.latestTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        tone: "muted",
      }],
    });
  }
  return info;
}

const TABLE_STREAM_OVERSCAN = 8;

export const INITIAL_STREAM_RANGE = { start: 0, end: 40 };

export function streamWindowRows<T>(
  rows: readonly T[],
  range: { start: number; end: number },
  selected: T | undefined,
): T[] {
  const window = rows.slice(Math.max(0, range.start - TABLE_STREAM_OVERSCAN), range.end + TABLE_STREAM_OVERSCAN);
  return selected !== undefined && !window.includes(selected) ? [...window, selected] : window;
}

export interface QuoteBoardCellFormat {
  sessionText?: boolean;
  formatPrice: (quote: Quote) => string;
  formatChange: (quote: Quote) => string;
}

type QuoteBoardCellKind = "status" | "price" | "change" | "changePercent" | "time";

function formatQuoteTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function renderQuoteBoardCell(
  kind: QuoteBoardCellKind,
  state: BoardQuoteState | undefined,
  format: QuoteBoardCellFormat,
): { text: string; value?: number | string | null; color?: string } {
  const quote = state?.quote;
  const loading = !quote && (state?.loading ?? true);
  if (loading) return { text: kind === "status" ? "" : "…", color: colors.textDim };
  switch (kind) {
    case "status": {
      const dot = marketStatusDot(quote?.marketState);
      return { text: dot.char, color: dot.color };
    }
    case "price":
      if (!quote || !Number.isFinite(quote.price)) return { text: "—", color: colors.textDim };
      return { text: format.formatPrice(quote), value: quote.price, color: state?.stale ? colors.textDim : undefined };
    case "change":
      if (!quote || !Number.isFinite(quote.change)) return { text: "—", color: colors.textDim };
      return { text: format.formatChange(quote), color: priceColor(quote.change) };
    case "changePercent":
      if (!quote || !Number.isFinite(quote.changePercent)) return { text: "—", color: colors.textDim };
      return { text: formatPercentRaw(quote.changePercent), value: quote.changePercent, color: priceColor(quote.changePercent) };
    case "time":
      return { text: formatQuoteTime(quote?.lastUpdated), color: colors.textDim };
  }
}

/** One glyph whose color is the session. A letter in the cell would spend the column on a label. */
export function marketStatusDot(state: MarketState | undefined): { char: string; color: string } {
  switch (state) {
    case "REGULAR":
      return { char: "●", color: colors.positive };
    case "PRE":
    case "POST":
    case "PREPRE":
    case "POSTPOST":
      return { char: "●", color: colors.warning };
    default:
      return { char: "●", color: colors.negative };
  }
}
