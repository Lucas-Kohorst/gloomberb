import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, type InputRenderable } from "../../../ui";
import type { PaneProps } from "../../../types/plugin";
import {
  EmptyState,
  InputSearchBar,
  Spinner,
  usePaneTicker,
  useUpdatedAgo,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { colors } from "../../../theme/colors";
import { usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { CboeBookClient } from "./client";
import {
  CBOE_BOOK_PANE_ID,
  DEFAULT_CBOE_MARKET,
  normalizeCboeMarket,
  CBOE_MARKETS,
  type CboeBook,
  type CboeMarket,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
/**
 * Cboe suggests re-polling the book every 5s (`reload: 5000` in the payload),
 * but a pane timer that tight would hammer the throttled client and fight the
 * global refresh cadence. 1 minute matches the fastest quote boards (traffic
 * aircraft) while staying inside the per-host budget.
 */
const REFRESH_INTERVAL_MINUTES = 1;

const MARKET_ORDER: readonly CboeMarket[] = CBOE_MARKETS;

function nextMarket(current: CboeMarket): CboeMarket {
  const idx = MARKET_ORDER.indexOf(current);
  return MARKET_ORDER[(idx + 1) % MARKET_ORDER.length]!;
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  return price.toFixed(2);
}

function formatShares(shares: number): string {
  if (!Number.isFinite(shares)) return "—";
  return Math.round(shares).toLocaleString("en-US");
}

function formatSigned(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

function LadderRow({
  side,
  shares,
  price,
  width,
}: {
  side: "ASK" | "BID";
  shares: number;
  price: number;
  width: number;
}) {
  const sideColor = side === "ASK" ? colors.negative : colors.positive;
  const sharesText = formatShares(shares).padStart(8);
  const priceText = formatPrice(price).padStart(10);
  const label = side.padEnd(3);
  return (
    <Box height={1} paddingX={1} width={width}>
      <Text fg={sideColor}>{label} </Text>
      <Text fg={colors.text}>{`${sharesText}  ${priceText}`}</Text>
    </Box>
  );
}

function SectionHeader({ title, width }: { title: string; width: number }) {
  return (
    <Box height={1} paddingX={1} width={width}>
      <Text fg={colors.textDim}>{title}</Text>
    </Box>
  );
}

export function CboeBookPane({ paneId, focused, width, height }: PaneProps) {
  const client = useMemo(() => new CboeBookClient(), []);
  const { symbol: boundSymbol } = usePaneTicker();

  const [storedSymbol] = usePaneSettingValue("symbol", "");
  const initialQuery = String(storedSymbol ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [storedMarket] = usePaneSettingValue("market", DEFAULT_CBOE_MARKET);
  const [market, setMarket] = usePluginPaneState<CboeMarket>(
    "market",
    normalizeCboeMarket(storedMarket),
  );

  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [book, setBook] = useState<CboeBook | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const effectiveSymbol = (query.trim() || boundSymbol || "").trim().toUpperCase();
  const normalizedMarket = normalizeCboeMarket(market);

  const load = useCallback(
    (symbol: string, nextMarket: CboeMarket) => {
      const target = symbol.trim().toUpperCase();
      if (!target) {
        abortRef.current?.abort();
        setBook(null);
        setStatus("loading");
        setError(null);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus((previous) => (previous === "loaded" ? "loaded" : "loading"));
      setError(null);
      void client
        .getBook(target, nextMarket)
        .then((next) => {
          if (abortRef.current !== controller || controller.signal.aborted) return;
          setBook(next);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setBook(null);
          setStatus("error");
        });
    },
    [client],
  );

  useEffect(() => {
    if (!effectiveSymbol) {
      abortRef.current?.abort();
      setBook(null);
      setStatus("loading");
      setError(null);
      return;
    }
    const timeoutId = setTimeout(
      () => load(effectiveSymbol, normalizedMarket),
      query.trim() ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timeoutId);
  }, [effectiveSymbol, normalizedMarket, load, query]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const refresh = useCallback(() => {
    if (effectiveSymbol) load(effectiveSymbol, normalizedMarket);
  }, [effectiveSymbol, load, normalizedMarket]);

  const cycleMarket = useCallback(() => {
    setMarket((current) => nextMarket(normalizeCboeMarket(current)));
  }, [setMarket]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery.toUpperCase());
    },
    [setQuery],
  );

  useShortcut(
    (event) => {
      if (!focused) return;
      if (searchFocused) {
        if (isPlainKey(event, "escape")) {
          event.stopPropagation?.();
          event.preventDefault?.();
          setSearchFocused(false);
          updateQuery("");
        }
        return;
      }
      if (event.targetEditable) return;
      if (isPlainKey(event, "/")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        focusSearch();
        return;
      }
      if (isPlainKey(event, "r")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        refresh();
        return;
      }
      if (isPlainKey(event, "m")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        cycleMarket();
      }
    },
    { allowEditable: true, enabled: focused },
  );

  const loading = status === "loading" && !book;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    refresh,
    REFRESH_INTERVAL_MINUTES,
  );

  const bestBid = book && book.bids.length > 0 ? book.bids[0]!.price : null;
  const bestAsk = book && book.asks.length > 0 ? book.asks[0]!.price : null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spreadBps = spread != null && mid != null && mid > 0 ? (spread / mid) * 10_000 : null;

  const pageUrl =
    effectiveSymbol && book
      ? `https://www.cboe.com/us/equities/market_statistics/book/${encodeURIComponent(effectiveSymbol)}/?mkt=${normalizedMarket}`
      : null;

  usePaneStatusLinkFooter({
    registrationId: paneId || CBOE_BOOK_PANE_ID,
    focused,
    url: pageUrl,
    source: effectiveSymbol ? `${effectiveSymbol} ${normalizedMarket.toUpperCase()}` : undefined,
    label: "book",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !!pageUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "market", key: "m", label: "arket", onPress: cycleMarket },
    ],
  });

  const searchBar = (
    <InputSearchBar
      value={query}
      focused={focused}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="Ticker, e.g. AAPL"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={(value) => value.trim().toUpperCase()}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateQuery}
    />
  );

  if (!effectiveSymbol) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title="No ticker selected."
            hint="Press / to enter a ticker."
          />
        </Box>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={`Loading book for ${effectiveSymbol}...`} />
        </Box>
      </Box>
    );
  }

  if ((status === "error" || !book) && !book) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title="Book unavailable."
            message={error ?? undefined}
            hint="Press r to retry."
          />
        </Box>
      </Box>
    );
  }

  if (!book || (book.asks.length === 0 && book.bids.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title="No book data."
            message={book?.company ? `${book.company} has no quoted levels.` : undefined}
            hint="Press r to retry."
          />
        </Box>
      </Box>
    );
  }

  const summaryCompany = book.company ?? book.symbol;
  const lastText = book.last != null ? formatPrice(book.last) : "—";
  const changeText = formatSigned(book.change);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {searchBar}
      <Box height={1} paddingX={1} width={width}>
        <Text fg={colors.textDim} wrapMode="ellipsis">
          {`${summaryCompany} Last ${lastText} ${changeText}`}
        </Text>
      </Box>
      <SectionHeader title={`ASKS ${normalizedMarket.toUpperCase()}`} width={width} />
      {book.asks.map((level, index) => (
        <LadderRow
          key={`ask-${level.price}-${index}`}
          side="ASK"
          shares={level.shares}
          price={level.price}
          width={width}
        />
      ))}
      <Box height={1} paddingX={1} width={width}>
        <Text fg={colors.textBright}>
          {`SPREAD ${spread != null ? formatPrice(spread) : "—"} | MID ${mid != null ? formatPrice(mid) : "—"}${
            spreadBps != null ? ` (${spreadBps.toFixed(1)}bps)` : ""
          }`}
        </Text>
      </Box>
      <SectionHeader title="BIDS" width={width} />
      {book.bids.map((level, index) => (
        <LadderRow
          key={`bid-${level.price}-${index}`}
          side="BID"
          shares={level.shares}
          price={level.price}
          width={width}
        />
      ))}
      {book.trades.length > 0 ? (
        <>
          <SectionHeader title="LAST TRADES" width={width} />
          {book.trades.slice(0, 5).map((trade, index) => (
            <Box key={`trade-${trade.time}-${index}`} height={1} paddingX={1} width={width}>
              <Text fg={colors.textMuted}>{`${trade.time}  `}</Text>
              <Text fg={colors.text}>{`${formatPrice(trade.price)}  `}</Text>
              <Text fg={colors.textDim}>{formatShares(trade.shares)}</Text>
            </Box>
          ))}
        </>
      ) : null}
    </Box>
  );
}
