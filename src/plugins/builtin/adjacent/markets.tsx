import { runAfterStartupBackground } from "../../../utils/startup-interaction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  PaneListChrome,
  Spinner,
  nextStackSortPreference,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type StackSortPreference,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { wrapTextLines } from "../../../utils/text-wrap";
import type { PaneProps } from "../../../types/plugin";
import { useAppDispatch, useAppSelector, usePaneInstance } from "../../../state/app/context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import { getSharedRegistry } from "../../registry";
import { usePluginAppActions } from "../../runtime";
import { ensureDefaultWatchlist } from "../../prediction-markets/collection-watchlist";
import {
  adjacentMarketTickerRecord,
  dispatchEnsuredWatchlistConfig,
  persistWatchlistMembership,
} from "../portfolio-list/register-watchlist-asset";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useFeedPollInterval } from "../shared/feed-poll-interval";
import { paneSearchHint, usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { AdjacentClient } from "./client";
import type { AdjacentMarketRow, AdjacentMarketSortColumnId } from "./types";
import {
  adjacentMarketSortValue,
  normalizeAdjacentMarket,
} from "./normalize";
import { applySortPreference } from "../../../utils/sort-values";
import { filterAdjacentRows } from "./search";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

const SEARCH_DEBOUNCE_MS = 250;

interface MarketColumn extends DataTableColumn {
  id: AdjacentMarketSortColumnId;
}

export function createMarketColumns(): MarketColumn[] {
  return [
    { id: "ticker", label: "TICKER", width: 12, align: "left" },
    { id: "title", label: "TITLE", width: 16, align: "left", flexGrow: 1 },
    { id: "platform", label: "VENUE", width: 4, align: "left" },
    { id: "status", label: "STATUS", width: 8, align: "left" },
    { id: "ends", label: "ENDS", width: 8, align: "left" },
  ];
}

function platformLabel(platform: AdjacentMarketRow["platform"]): string {
  return platform === "kalshi" ? "K" : "P";
}

function formatEndsAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderMarketCell(
  row: AdjacentMarketRow,
  column: MarketColumn,
  selected: boolean,
): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "ticker":
      return { text: row.ticker, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "title":
      return { text: row.title, color: sel ?? colors.text };
    case "platform":
      return { text: platformLabel(row.platform), color: sel ?? colors.textDim };
    case "status":
      return { text: row.status, color: sel ?? colors.textDim };
    case "ends":
      return { text: formatEndsAt(row.endsAt), color: sel ?? colors.textDim };
  }
}

function MarketDetail({
  row,
  width,
  height,
}: {
  row: AdjacentMarketRow;
  width: number;
  height: number;
}) {
  const lineWidth = Math.max(12, width - 2);
  const venue = row.platform === "kalshi" ? "Kalshi" : "Polymarket";
  const meta = [venue, row.ticker, row.status, formatEndsAt(row.endsAt)]
    .filter((part) => part && part !== "—")
    .join(" · ");
  const lines = [
    meta,
    row.category,
    row.subtitle,
    row.description,
  ].flatMap((entry) => (entry ? wrapTextLines(entry, lineWidth) : []));

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      <ScrollBox width={width - 2} height={height} stickyScroll={false}>
        {lines.length === 0 ? (
          <Text fg={colors.textDim}>No catalog detail.</Text>
        ) : (
          lines.map((line, index) => (
            <Text key={`${index}:${line}`} fg={index === 0 ? colors.textDim : colors.text}>
              {line}
            </Text>
          ))
        )}
      </ScrollBox>
    </Box>
  );
}

export function AdjacentMarketsPane({
  client,
  focused,
  width,
  height,
}: {
  client: AdjacentClient;
} & PaneProps) {
  const [markets, setMarkets] = useState<AdjacentMarketRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sortPreference, setSortPreference] = useState<StackSortPreference<AdjacentMarketSortColumnId>>({
    columnId: "ticker",
    direction: "asc",
  });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const paneInstance = usePaneInstance();
  const seedQuery = typeof paneInstance?.params?.query === "string" ? paneInstance.params.query.trim() : "";
  const [searchQuery, setSearchQuery] = useState(seedQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<import("../../../ui").InputRenderable | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seededRef = useRef(false);
  const initialLoadRef = useRef(true);

  const load = useCallback((query: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus((current) => (current === "loaded" ? "loaded" : "loading"));
    setError(null);
    const trimmed = query.trim();
    const request = trimmed
      ? client.searchMarkets(trimmed, 50, undefined, { signal: controller.signal })
      : client.getMarkets({ limit: 50 });
    void request
      .then((response) => {
        if (abortRef.current !== controller) return;
        const rows = (response.markets ?? response.data ?? []).map(normalizeAdjacentMarket);
        setMarkets(rows);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((err) => {
        if (abortRef.current !== controller) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, [client]);

  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return runAfterStartupBackground(() => {
        load(searchQuery);
      });
    }
    load(searchQuery);
  }, [load, searchQuery]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const columns = useMemo(() => createMarketColumns(), []);
  const visibleMarkets = useMemo(() => {
    const rows = filterAdjacentRows(markets, searchQuery, (row) =>
      [row.ticker, row.title, row.platform, row.id].filter(Boolean).join(" "),
    );
    return applySortPreference(rows, sortPreference, adjacentMarketSortValue);
  }, [markets, searchQuery, sortPreference]);
  const selectedMarket = visibleMarkets.find((row) => row.id === selectedId) ?? null;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const poll = useFeedPollInterval();
  const reload = useCallback(() => load(searchQuery), [load, searchQuery]);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, reload, poll.intervalMinutes);

  useEffect(() => {
    if (visibleMarkets.length === 0) return;
    if (!selectedId || !visibleMarkets.some((row) => row.id === selectedId)) {
      setSelectedId(visibleMarkets[0]!.id);
    }
  }, [selectedId, visibleMarkets]);

  useEffect(() => {
    if (seededRef.current || !seedQuery || markets.length === 0) return;
    const query = seedQuery.toLowerCase();
    const match = markets.find((row) => (
      row.ticker.toLowerCase() === query
      || row.id.toLowerCase() === query
      || row.title.toLowerCase() === query
    )) ?? markets.find((row) => (
      row.ticker.toLowerCase().includes(query) || row.title.toLowerCase().includes(query)
    ));
    if (!match) return;
    seededRef.current = true;
    setSelectedId(match.id);
    setDetailOpen(true);
  }, [markets, seedQuery]);

  const [detailRow, setDetailRow] = useState<AdjacentMarketRow | null>(null);
  useEffect(() => {
    if (!selectedMarket || !detailOpen) {
      setDetailRow(selectedMarket);
      return;
    }
    let cancelled = false;
    setDetailRow(selectedMarket);
    void client.getMarket(selectedMarket.id)
      .then((detail) => {
        if (cancelled) return;
        setDetailRow({
          ...normalizeAdjacentMarket(detail),
          ticker: selectedMarket.ticker,
          title: detail.title || selectedMarket.title,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDetailRow(selectedMarket);
      });
    return () => {
      cancelled = true;
    };
  }, [client, detailOpen, selectedMarket]);

  const renderCell = useCallback(
    (row: AdjacentMarketRow, column: MarketColumn, _index: number, rowState: { selected: boolean }) =>
      renderMarketCell(row, column, rowState.selected),
    [],
  );
  const getRowRevision = useCallback(
    (row: AdjacentMarketRow) => `${row.id}:${row.status}:${row.endsAt ?? ""}`,
    [],
  );
  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((value) => value + 1);
  }, []);
  const marketUrl = selectedMarket?.url ?? detailRow?.url ?? null;
  const { notify } = usePluginAppActions();
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const tickers = useAppSelector((state) => state.tickers);
  const registerSelected = useCallback(() => {
    if (!selectedMarket || detailOpen) return;
    const registry = getSharedRegistry();
    if (!registry) {
      notify({ type: "error", body: "Ticker lookup unavailable." });
      return;
    }
    const ensured = ensureDefaultWatchlist(config);
    dispatchEnsuredWatchlistConfig(config, ensured.config, dispatch, scheduleConfigSave);
    const symbol = (selectedMarket.ticker || selectedMarket.id).toUpperCase();
    const ticker = adjacentMarketTickerRecord({
      id: selectedMarket.id,
      ticker: selectedMarket.ticker,
      title: selectedMarket.title,
      platform: selectedMarket.platform,
    }, tickers.get(symbol) ?? null);
    void persistWatchlistMembership({
      ticker,
      watchlistId: ensured.watchlistId,
      tickerRepository: registry.tickerRepository,
      dispatch,
    }).then((result) => {
      notify({
        type: result.changed ? "success" : "info",
        body: result.changed
          ? `${result.ticker.metadata.ticker} added to Watchlist.`
          : `${result.ticker.metadata.ticker} is already on Watchlist.`,
      });
    });
  }, [config, detailOpen, dispatch, notify, selectedMarket, tickers]);
  const watchlistId = ensureDefaultWatchlist(config).watchlistId;
  const selectedSymbol = selectedMarket
    ? (selectedMarket.ticker || selectedMarket.id).toUpperCase()
    : "";
  const selectedAlreadyOnWatchlist = selectedSymbol
    ? (tickers.get(selectedSymbol)?.metadata.watchlists.includes(watchlistId) ?? false)
    : false;

  usePaneStatusLinkFooter({
    registrationId: "adjacent-markets",
    focused,
    url: marketUrl,
    label: "market",
    loading: status === "loading",
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    trailingInfo: [poll.segment],
    showOpenHint: !!marketUrl,
    hints: [
      paneSearchHint(focusSearch),
      ...(!detailOpen
        ? [{ id: "add", key: "a", label: "dd", onPress: registerSelected, disabled: !selectedMarket || selectedAlreadyOnWatchlist }]
        : []),
    ],
  });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "/")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      reload();
      return true;
    }
    return false;
  }, [focusSearch, reload]);

  useShortcut((event) => {
    if (!focused || detailOpen || searchFocused) return;
    if (isPlainKey(event, "/")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      reload();
    }
  }, { enabled: focused && !detailOpen && !searchFocused });

  if (status === "loading" && markets.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <PaneListChrome
          width={width}
          focused={focused}
          search={{
            value: searchQuery,
            active: searchFocused,
            focusToken: searchFocusToken,
            inputRef: searchInputRef,
            placeholder: "market, ticker, or question",
            debounceMs: SEARCH_DEBOUNCE_MS,
            onFocus: focusSearch,
            onBlur: () => setSearchFocused(false),
            onNavigateDown: () => setSearchFocused(false),
            onQueryChange: setSearchQuery,
          }}
        />
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={searchQuery.trim() ? `Searching Adjacent for ${searchQuery.trim()}...` : "Loading Adjacent markets..."} />
        </Box>
      </Box>
    );
  }

  if (error && markets.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1}>
          <EmptyState title="Adjacent markets unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  const shownDetail = detailRow ?? selectedMarket;
  const detailContent = shownDetail ? (
    <MarketDetail
      row={shownDetail}
      width={width}
      height={Math.max(height - 1, 1)}
    />
  ) : null;

  return (
    <DataTableStackView<AdjacentMarketRow, MarketColumn>
      focused={focused && !searchFocused}
      detailOpen={detailOpen && !!shownDetail}
      onBack={() => setDetailOpen(false)}
      detailContent={detailContent}
      detailTitle={shownDetail?.title}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={() => setDetailOpen(true)}
      onRootKeyDown={handleRootKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={visibleMarkets}
      rootBefore={(
        <PaneListChrome
          width={width}
          focused={focused}
          search={{
            value: searchQuery,
            active: searchFocused,
            focusToken: searchFocusToken,
            inputRef: searchInputRef,
            placeholder: "market, ticker, or question",
            debounceMs: SEARCH_DEBOUNCE_MS,
            onFocus: focusSearch,
            onBlur: () => setSearchFocused(false),
            onNavigateDown: () => setSearchFocused(false),
            onQueryChange: setSearchQuery,
          }}
        />
      )}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => {
        const next = columnId as AdjacentMarketSortColumnId;
        setSortPreference((current) => nextStackSortPreference(
          current,
          next,
          next === "ends" ? "desc" : "asc",
        ));
      }}
      getItemKey={(row) => row.id}
      getRowRevision={getRowRevision}
      renderCell={renderCell}
      emptyStateTitle="No Adjacent markets."
      emptyStateHint="Try a different search."
    />
  );
}
