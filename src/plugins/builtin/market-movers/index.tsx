import { Box } from "../../../ui";
import { nextHeaderSort } from "../../../utils/sort-values";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTableView, EmptyState, QueryBar, usePaneFooter, usePaneTabs, useQueryBarSearch, type DataTableKeyEvent } from "../../../components";
import { handleRefreshKey } from "../../../components/data-table/table-pane";
import type { PaneProps } from "../../../types/plugin";
import type { PaneTemplateCreateOptions, PaneTemplateInstanceConfig } from "../../../types/plugin";
import { canadaListingsHeadless } from "../canada-listings/headless";
import type { PluginModule } from "../plugin-module";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { publicTickerKey } from "../../../utils/exchanges";
import { usePaneInstance, usePaneSettingValue } from "../../../state/app/context";
import { usePlanAccess } from "../../../api-client/plan-access";
import { useAssetData, usePluginPaneState, usePluginTickerActions } from "../../runtime";
import { useLiveQuoteEntries } from "../../../state/hooks/quote-streaming";
import { useAutoRefresh } from "../../../react/auto-refresh";
import { useQuoteBoard } from "../shared/use-quote-board";
import {
  attachMarketMoversPersistence,
  MARKET_SUMMARY_SYMBOLS,
  resetMarketMoversPersistence,
  type ScreenerQuote,
  type MarketSummaryQuote,
} from "./screener";
import {
  DEFAULT_SORT_PREFERENCE,
  INDEX_SHORT,
  TABS,
  createRows,
  overlayMarketMoverQuotes,
  resolveSummarySymbols,
  resolveTabs,
  sortRows,
  summaryQuoteFromQuote,
  torontoListingQuote,
  type MarketMoverColumn,
  type MarketMoverRow,
  type MarketMoverSortPreference,
  type ScreenerTabId,
  type TabId,
} from "./model";
import { fetchCanadaListings } from "../canada-listings/client";
import { loadMarketMoverTab } from "./client";
import { summaryFooterSegments } from "./footer";
import { isSessionTab, resolveActiveTab, usSessionAt, type UsSession } from "./session";
import { SessionMoversBody } from "./session-body";
import { marketMoversHeadless } from "./headless";
import { buildMarketMoverColumns, renderMarketMoverCell } from "./table";
import {
  LIVE_STREAMING_QUICK_SETTING,
  useLiveStreamingSetting,
  withLiveStreamingSetting,
} from "../../../state/hooks/live-streaming";
import {
  buildScreenerQuoteTargets,
  resolveScreenerQuoteFeedStatus,
} from "../../../market-data/quotes/screener-live-quotes";


/** Stable identity: a fresh literal here would reload the board every render. */
const NO_SAVED_SELECTION: string[] = [];
const SESSION_CHECK_MS = 30_000;
const NO_QUOTES: ScreenerQuote[] = [];
const moverKey = (row: Pick<ScreenerQuote, "symbol" | "exchange">) => publicTickerKey(row.symbol, row.exchange);

/** What is trading in New York, re-read every half minute so the pane follows 04:00, 09:30 and 16:00. */
function useUsSession(): UsSession {
  const [session, setSession] = useState(() => usSessionAt(Date.now()));
  useEffect(() => {
    const timer = setInterval(() => {
      const next = usSessionAt(Date.now());
      setSession((current) => (current.key === next.key ? current : next));
    }, SESSION_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return session;
}

function MarketMoversPane({ focused, width, height }: PaneProps) {
  const liveStreaming = useLiveStreamingSetting();
  const [savedTabs] = usePaneSettingValue<string[]>("tabs", NO_SAVED_SELECTION);
  const [savedSummarySymbols] = usePaneSettingValue<string[]>("summarySymbols", NO_SAVED_SELECTION);
  const tabs = useMemo(() => resolveTabs(savedTabs), [savedTabs]);
  const summarySymbols = useMemo(() => resolveSummarySymbols(savedSummarySymbols), [savedSummarySymbols]);
  // Pane state rather than local state, so a restored layout opens on the tab
  // the user picked. `--list` on the CLI and screenshots land in `requestedTab`,
  // which holds until the user picks a tab, whatever session is trading.
  const [savedTab, setSavedTab] = usePluginPaneState<TabId>("activeTab", tabs[0]!.id);
  const [pickedIn, setPickedIn] = usePluginPaneState<string | null>("activeTabSession", null);
  const [openingList] = usePaneSettingValue<string | null>("requestedList", null);
  const [requestedTab, setRequestedTab] = usePluginPaneState<TabId | null>("requestedTab", openingList as TabId | null);
  const access = usePlanAccess();
  const session = useUsSession();
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const activeTab = resolveActiveTab({
    tabs: tabIds,
    saved: savedTab,
    pickedIn,
    session,
    requested: requestedTab,
    sessionListsOpen: access.signedIn && access.emailVerified && access.hasProAccess,
  });

  // The index summary is a quote board like any other, so it runs on the shared
  // one instead of a third parallel pipeline against the same upstream.
  const { quotes: summaryBoard } = useQuoteBoard(summarySymbols, { liveStreaming });
  const summaryQuotes = useMemo<MarketSummaryQuote[]>(() => (
    summarySymbols
      .map((symbol) => {
        const quote = summaryBoard.get(symbol)?.quote;
        return quote ? summaryQuoteFromQuote(symbol, quote) : null;
      })
      .filter((quote): quote is MarketSummaryQuote => !!quote)
  ), [summaryBoard, summarySymbols]);

  const tabItems = tabs.map((tab) => ({ label: tab.label, value: tab.id }));
  const selectTab = (value: string) => {
    setSavedTab(value as TabId);
    setPickedIn(session.key);
    if (requestedTab) setRequestedTab(null);
  };
  const { strip: tabStrip } = usePaneTabs({ tabs: tabItems, activeValue: activeTab, onSelect: selectTab, focused, compact: true, variant: "bare" });

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabStrip && <Box height={1} paddingX={1}>{tabStrip}</Box>}
      {isSessionTab(activeTab) ? (
        <SessionMoversBody
          view={activeTab}
          height={height - (tabStrip ? 1 : 0)}
          session={session}
          focused={focused}
          width={width}
          summaryQuotes={summaryQuotes}
          liveStreaming={liveStreaming}
        />
      ) : (
        <ScreenerMoversBody
          activeTab={activeTab}
          focused={focused}
          width={width}
          summaryQuotes={summaryQuotes}
          liveStreaming={liveStreaming}
        />
      )}
    </Box>
  );
}

/** Gainers, losers, most active and trending: day screeners with live quotes on the rows. */
function ScreenerMoversBody({ activeTab, focused, width, summaryQuotes, liveStreaming }: {
  activeTab: ScreenerTabId;
  focused: boolean;
  width: number;
  summaryQuotes: MarketSummaryQuote[];
  liveStreaming: boolean;
}) {
  const dataProvider = useAssetData();
  const { pinTicker } = usePluginTickerActions();
  const [quotes, setQuotes] = useState<ScreenerQuote[]>([]);
  const [openingExchange] = usePaneSettingValue("listingExchange", "us");
  const [exchange, setExchange] = usePluginPaneState("listingExchange", openingExchange === "tsx" ? "tsx" : "us");
  const instance = usePaneInstance();
  const rawSymbol = instance?.params?.symbol ?? instance?.settings?.symbol;
  const openingSymbol = typeof rawSymbol === "string" ? rawSymbol.trim() : "";
  const [search, setSearch] = usePluginPaneState("listingQuery", openingSymbol);
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const needle = activeTab === "actives" ? search.trim().toLowerCase() : "";
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const boardKey = activeTab === "actives" ? `${activeTab}:${exchange}` : activeTab;
  const visibleQuotes = loadedKey === boardKey ? quotes : NO_QUOTES;
  const toronto = activeTab === "actives" && exchange === "tsx";
  // The first load starts before the effect runs; an empty board is not "no data".
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<MarketMoverSortPreference>(DEFAULT_SORT_PREFERENCE);
  const [moversStale, setMoversStale] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const fetchGenRef = useRef(0);

  const quoteTargets = useMemo(
    () => toronto ? [] : buildScreenerQuoteTargets(visibleQuotes, selectedSymbol),
    [toronto, visibleQuotes, selectedSymbol],
  );
  const {
    entries: liveQuoteEntries,
    freshnessNow,
    subscriptionStartedAt,
  } = useLiveQuoteEntries(quoteTargets, {
    freshnessScopeKey: `market-movers:${activeTab}`,
    liveStreaming,
  });
  const resolvedQuotes = useMemo(
    () => overlayMarketMoverQuotes(visibleQuotes, liveQuoteEntries),
    [liveQuoteEntries, visibleQuotes],
  );
  const feedStatus = useMemo(
    () => resolveScreenerQuoteFeedStatus(quoteTargets, liveQuoteEntries, {
      now: freshnessNow,
      subscriptionStartedAt,
    }),
    [freshnessNow, liveQuoteEntries, quoteTargets, subscriptionStartedAt],
  );
  const columns = useMemo(() => buildMarketMoverColumns(width), [width]);
  const rankedRows = useMemo(() => createRows(resolvedQuotes), [resolvedQuotes]);
  const rows = useMemo(() => sortRows(
    needle ? rankedRows.filter((row) => `${row.symbol} ${row.name}`.toLowerCase().includes(needle)) : rankedRows,
    sortPreference,
  ), [needle, rankedRows, sortPreference]);
  const selectedIdx = selectedSymbol
    ? rows.findIndex((row) => moverKey(row) === selectedSymbol)
    : -1;
  useEffect(() => {
    if (selectedSymbol && selectedIdx >= 0) return;
    const firstRow = rows[0];
    if (firstRow) {
      setSelectedSymbol(moverKey(firstRow));
    } else if (selectedSymbol !== null) {
      setSelectedSymbol(null);
    }
  }, [rows, selectedIdx, selectedSymbol]);

  const loadTab = useCallback(async (
    tab: ScreenerTabId,
    options?: { forceRefresh?: boolean; background?: boolean },
  ) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    if (!options?.background) {
      setLoading(true);
      setLoadError(null);
    }

    const boardKey = tab === "actives" ? `${tab}:${exchange}` : tab;
    try {
      if (tab === "actives" && exchange === "tsx") {
        const listings = await fetchCanadaListings();
        if (fetchGenRef.current !== gen) return;
        setQuotes(listings.map(torontoListingQuote));
        setLoadedKey(boardKey);
        setMoversStale(false);
        if (!options?.background) setSelectedSymbol(null);
        setLoadError(null);
        setLastLoadedAt(Date.now());
        return;
      }
      const result = await loadMarketMoverTab(tab, dataProvider, {
        forceRefresh: options?.forceRefresh,
      });
      if (fetchGenRef.current !== gen) return;

      setQuotes(result.quotes);
      setLoadedKey(boardKey);
      setMoversStale(result.stale);
      if (!options?.background) setSelectedSymbol(null);
      setLoadError(null);
      setLastLoadedAt(Date.now());
    } catch (error) {
      if (fetchGenRef.current !== gen) return;
      setMoversStale(true);
      setLoadError(tab === "actives" && exchange === "tsx" && error instanceof Error
        ? error.message
        : "Market movers temporarily unavailable");
    }
    finally {
      if (fetchGenRef.current === gen && !options?.background) setLoading(false);
    }
  }, [dataProvider, exchange]);

  useEffect(() => {
    setSelectedSymbol(null);
    void loadTab(activeTab);
  }, [activeTab, loadTab]);

  const backgroundRefresh = useCallback(() => {
    void loadTab(activeTab, { background: true });
  }, [activeTab, loadTab]);
  useAutoRefresh(lastLoadedAt, backgroundRefresh);

  const openSymbol = useCallback((row: MarketMoverRow) => {
    pinTicker(moverKey(row), { floating: true, paneType: TICKER_RESEARCH_PANE_ID, instrument: null });
  }, [pinTicker]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextHeaderSort(current, columnId as MarketMoverColumn["id"], {
      resetTo: DEFAULT_SORT_PREFERENCE,
    }));
  }, []);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => (
    handleRefreshKey(event, () => loadTab(activeTab, { forceRefresh: true }), { stopPropagation: true })
  ), [activeTab, loadTab]);

  usePaneFooter("market-movers", () => ({
    info: [
      ...(loadError ? [{ id: "load-error", parts: [{ text: loadError, tone: "warning" as const }] }] : []),
      ...summaryFooterSegments(summaryQuotes),
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(feedStatus ? [{
        id: "feed",
        parts: [{ text: feedStatus, tone: feedStatus === "live" ? "value" as const : "muted" as const }],
      }] : []),
      ...(moversStale && loadedKey === boardKey ? [{
        id: "stale",
        parts: [{ text: "stale", tone: "muted" as const }],
      }] : []),
    ],
  }), [boardKey, feedStatus, loadedKey, loadError, loading, moversStale, summaryQuotes]);

  return (
    <DataTableView<MarketMoverRow, MarketMoverColumn>
      focused={focused && !searchActive}
      selection={{
        kind: "id",
        selectedId: selectedSymbol,
        getId: moverKey,
        onChange: (symbol) => setSelectedSymbol(symbol),
      }}
      onRootKeyDown={handleTableKeyDown}
      resetScrollKey={boardKey}
      rootBefore={activeTab === "actives" ? (
        <QueryBar
          width={Math.max(1, width - 2)}
          search={{ value: search, onChange: setSearch, placeholder: "symbol", focused, ...searchProps }}
          filters={[{
            id: "exchange",
            label: "Exchange",
            inline: true,
            value: exchange,
            defaultValue: "us",
            options: [{ value: "us", label: "US" }, { value: "tsx", label: "Toronto" }],
            onChange: setExchange,
          }]}
        />
      ) : undefined}
      sortable
      columns={columns}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={moverKey}
      onActivate={openSymbol}
      renderCell={renderMarketMoverCell}
      selectedTextOverridesCellColor
      emptyStateTitle={loading ? "Loading movers..." : loadError ?? (needle ? "No matching symbols." : "No movers returned.")}
      emptyContent={loadError ? (
        <Box paddingX={1} paddingY={1}>
          <EmptyState title={loadError} message="Try again in a moment." />
        </Box>
      ) : undefined}
    />
  );
}

function torontoInstance(options?: PaneTemplateCreateOptions): PaneTemplateInstanceConfig {
  const symbol = options?.arg?.trim().toUpperCase() ?? "";
  return {
    placement: "floating",
    settings: { listingExchange: "tsx", requestedList: "actives", ...(symbol ? { symbol } : {}) },
    ...(symbol ? { params: { symbol }, title: `Toronto ${symbol}` } : {}),
  };
}

export const marketMoversModule: PluginModule = {
  setup(ctx) {
    attachMarketMoversPersistence(ctx.persistence);
  },

  dispose() {
    resetMarketMoversPersistence();
  },

  panes: [
    {
      id: "market-movers",
      name: "Market Movers",
      icon: "T",
      component: MarketMoversPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 36 },
      tableExport: true,
      quickSettings: [LIVE_STREAMING_QUICK_SETTING],
      settings: (context) => withLiveStreamingSetting({
        title: "Market Movers Settings",
        values: {
          tabs: resolveTabs(context.settings.tabs as string[] | undefined).map((tab) => tab.id),
          summarySymbols: resolveSummarySymbols(context.settings.summarySymbols as string[] | undefined),
        },
        fields: [
          {
            key: "tabs",
            label: "Lists",
            type: "ordered-multi-select",
            options: TABS.map((tab) => ({ value: tab.id, label: tab.label })),
          },
          {
            key: "summarySymbols",
            label: "Index summary",
            type: "ordered-multi-select",
            options: MARKET_SUMMARY_SYMBOLS.map((symbol) => ({
              value: symbol,
              label: INDEX_SHORT[symbol] ?? symbol,
            })),
          },
        ],
      }, context.settings),
    },
  ],

  paneTemplates: [
    {
      id: "market-movers-pane",
      paneId: "market-movers",
      label: "Market Movers",
      description: "Top gainers, losers, most active, and trending tickers, pre-market and after-hours movers, and gaps.",
      keywords: ["movers", "gainers", "losers", "active", "trending", "screener", "top", "premarket", "pre-market", "after-hours", "gaps", "gap"],
      shortcut: { prefix: "MOST" },
      headless: marketMoversHeadless,
    },
    {
      id: "canada-listings-pane",
      paneId: "market-movers",
      label: "Canada Listings",
      description: "Most active Toronto Stock Exchange listings by session volume, with last, change and volume.",
      keywords: ["canada", "toronto", "tsx", "listing", "listings", "most active", "volume"],
      shortcut: { prefix: "TMX", argKind: "text", argPlaceholder: "symbol", argOptional: true },
      headless: canadaListingsHeadless,
      createInstance: (_context, options) => torontoInstance(options),
    },
  ],
};
