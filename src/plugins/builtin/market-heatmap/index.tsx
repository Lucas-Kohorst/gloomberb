import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, useUiCapabilities } from "../../../ui";
import {
  buildMetricTreemapNavigationTiles,
  findMetricTreemapNeighbor,
  MetricTreemapSurface,
  PaneStatusBody,
  Tabs,
  unavailableText,
  usePaneFooter,
  usePaneHeaderTabs,
  usePaneNoticeFooter,
  usePaneStatusFooter, usePaneLoadingSignal,
  type MetricTreemapDirection,
  type MetricTreemapItem,
} from "../../../components";
import { handleRefreshKey } from "../../../components/data-table/table-pane";
import { useShortcut } from "../../../react/input";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { GloomPlugin, PaneProps, PaneSettingField } from "../../../types/plugin";
import type { TickerRecord } from "../../../types/ticker";
import { tf } from "../../../i18n";
import { priceColor } from "../../../theme/colors";
import { formatCompact, formatCurrency, formatPercentRaw } from "../../../utils/format";
import { isPlainKey } from "../../../utils/keyboard";
import { useAppSelector, usePaneAppConfig, usePaneSettingValue } from "../../../state/app/context";
import { usePluginTickerActions } from "../../runtime";
import { useLiveQuoteEntries } from "../../../state/hooks/quote-streaming";
import { useFxRatesMap, useTickerFinancialsMap } from "../../../market-data/hooks";
import { getSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { instrumentFromTicker, type InstrumentRef } from "../../../market-data/request-types";
import {
  buildTrackedCurrencies,
  getCollectionTickersFromConfig,
  getCollectionTypeFromConfig,
} from "../portfolio-list/pane/data";
import { resolvePortfolioTotalsCurrency } from "../portfolio-list/metrics";
import { useThrottledMemo } from "../portfolio-list/use-throttled-memo";
import { PORTFOLIO_REORDER_THROTTLE_MS } from "../portfolio-list/use-throttled-ticker-order";
import {
  MARKET_HEATMAP_UNIVERSES,
  fetchMarketHeatmap,
  resetMarketHeatmapCache,
  type MarketHeatmapUniverseId,
} from "./data";
import {
  PORTFOLIO_HEATMAP_TAB,
  buildPortfolioHeatmapAssets,
  fallbackHeatmapCollectionId,
  heatmapCollectionLabel,
  heatmapFollowsCollection,
  heatmapTabId,
  isRemoteHeatmapUniverse,
  useLinkedHeatmapCollection,
  type HeatmapBoardAsset,
} from "./portfolio";
import {
  HEATMAP_RELAXED_LAYOUT,
  HEATMAP_REST_ID,
  heatmapBoardEntries,
  heatmapEntryId,
  placeHeatmapEntries,
  unfoldEntireRest,
  type HeatmapBoardEntry,
  type HeatmapFoldLayout,
} from "./remainder";
import { useAutoRefresh, useUpdatedAgo } from "../../../react/auto-refresh";
import {
  LIVE_STREAMING_QUICK_SETTING,
  useLiveStreamingSetting,
  withLiveStreamingSetting,
} from "../../../state/hooks/live-streaming";
import {
  buildScreenerQuoteTargets,
  overlayScreenerQuoteEntries,
  resolveScreenerQuoteFeedStatus,
} from "../../../market-data/quotes/screener-live-quotes";

const NO_ASSETS: HeatmapBoardAsset[] = [];
const NO_BOARD = { assets: NO_ASSETS, omitted: 0 };
const EMPTY_TICKERS: TickerRecord[] = [];
const NO_CURRENCIES: string[] = [];
const EMPTY_TITLE = "No market heatmap data.";
const EMPTY_PORTFOLIO_TITLE = "No symbols in this list.";

function loadCollectionSnapshots(
  tickers: readonly TickerRecord[],
  collectionId: string | null,
  kind: "portfolio" | "watchlist" | null,
  forceRefresh = false,
): void {
  const coordinator = getSharedMarketDataCoordinator();
  if (!coordinator || !collectionId) return;
  const instrumentOptions = kind === "portfolio" ? { portfolioId: collectionId } : {};
  const instruments = tickers.flatMap((ticker): InstrumentRef[] => {
    const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker, instrumentOptions);
    return instrument ? [instrument] : [];
  });
  if (instruments.length > 0) void coordinator.loadSnapshotsBatch(instruments, { forceRefresh }).catch(() => {});
}

function formatMoneyCompact(value: number | null | undefined, currency: string): string {
  if (value == null) return "—";
  if (currency.toUpperCase() === "USD") return `$${formatCompact(value)}`;
  return `${formatCompact(value)} ${currency}`;
}

function sizeLabel(asset: HeatmapBoardAsset): string | null {
  if (asset.showSize === false || asset.size == null) return null;
  const label = asset.sizeCaption ?? (asset.sizeKind === "net-assets" ? "Assets" : "Mkt");
  return `${label} ${formatMoneyCompact(asset.size, asset.sizeCurrency ?? asset.currency)}`;
}

function selectedFooter(entry: HeatmapBoardEntry) {
  if (entry.kind === "rest") {
    const { group } = entry;
    return {
      id: "selected",
      parts: [
        { text: `+${group.assets.length}`, tone: "label" as const },
        {
          text: group.hasChange ? formatPercentRaw(group.changePercent) : "—",
          tone: "value" as const,
          color: group.hasChange ? priceColor(group.changePercent) : undefined,
          bold: true,
        },
      ],
    };
  }
  const asset = entry.asset;
  return {
    id: "selected",
    parts: [
      { text: asset.symbol, tone: "label" as const },
      { text: formatCurrency(asset.price, asset.currency), tone: "value" as const },
      {
        text: asset.hasChange ? formatPercentRaw(asset.changePercent) : "—",
        tone: "value" as const,
        color: asset.hasChange ? priceColor(asset.changePercent) : undefined,
        bold: true,
      },
    ],
  };
}

function buildEntryItems(entries: readonly HeatmapBoardEntry[]): Array<MetricTreemapItem<HeatmapBoardEntry>> {
  return entries.map((entry) => {
    if (entry.kind === "rest") {
      const { group } = entry;
      return {
        id: HEATMAP_REST_ID,
        label: `+${group.assets.length}`,
        weight: group.weight,
        colorValue: group.hasChange ? group.changePercent : null,
        primaryText: group.hasChange ? formatPercentRaw(group.changePercent) : "—",
        secondaryText: group.size > 0 ? `Mkt ${formatMoneyCompact(group.size, group.sizeCurrency)}` : null,
        tertiaryText: null,
        data: entry,
      };
    }
    const asset = entry.asset;
    return {
      id: asset.symbol,
      label: asset.symbol,
      weight: asset.weight ?? asset.size ?? 0,
      colorValue: asset.hasChange ? asset.changePercent : null,
      // No change data is not a flat session; 0.00% would be a made-up number.
      primaryText: asset.hasChange ? formatPercentRaw(asset.changePercent) : "—",
      secondaryText: sizeLabel(asset),
      tertiaryText: asset.volume != null ? `Vol ${formatCompact(asset.volume)}` : asset.exchange || null,
      data: entry,
    };
  });
}

/**
 * A tile that clips "$1.0T" into "$1.0" reads as a real, wrong number, so a
 * metric that does not fit its tile is dropped instead of truncated. Layout
 * depends on weights alone, so re-rendering with shorter text keeps the same
 * geometry.
 */
function fitItemsToTiles(
  items: Array<MetricTreemapItem<HeatmapBoardEntry>>,
  tiles: Array<{ item: { id: string }; width: number; height: number }>,
): Array<MetricTreemapItem<HeatmapBoardEntry>> {
  const tileById = new Map(tiles.map((tile) => [tile.item.id, tile]));
  return items.map((item) => {
    const tile = tileById.get(item.id);
    if (!tile) return item;
    // Mirrors the terminal tile's own padding: one cell of border, one of gutter.
    const innerWidth = Math.max(1, Math.floor(tile.width) - (tile.width > 2 ? 1 : 0) - 1);
    const fits = (text: string | null | undefined) => (
      text != null && text.length <= innerWidth ? text : null
    );
    return {
      ...item,
      primaryText: fits(item.primaryText),
      secondaryText: fits(item.secondaryText),
      tertiaryText: fits(item.tertiaryText),
    };
  });
}

function MarketHeatmapPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const liveStreaming = useLiveStreamingSetting();
  const { cellWidthPx = 8, cellHeightPx = 18, nativePaneChrome } = useUiCapabilities();
  // A pane setting, not private pane state, so the settings dialog can show it.
  const [universeSetting, setActiveUniverse] = usePaneSettingValue<string>("universe", "us-equity");
  const [linkPortfolio] = usePaneSettingValue<boolean>("linkPortfolio", false);
  const activeUniverse = heatmapTabId(universeSetting);
  const portfolioTab = activeUniverse === PORTFOLIO_HEATMAP_TAB;
  const config = usePaneAppConfig();
  const tickersBySymbol = useAppSelector((state) => state.tickers);
  const linkedPortfolio = useLinkedHeatmapCollection();
  const collectionId = linkedPortfolio.collectionId ?? fallbackHeatmapCollectionId(config);
  const collectionKind = getCollectionTypeFromConfig(config, collectionId);
  const portfolioLabel = heatmapCollectionLabel(config, collectionId);
  const universeTabs = useMemo(() => [
    ...MARKET_HEATMAP_UNIVERSES.map((universe) => ({ label: universe.label, value: universe.id })),
    { label: portfolioLabel, value: PORTFOLIO_HEATMAP_TAB },
  ], [portfolioLabel]);
  const collectionTickers = useMemo(
    () => (portfolioTab && collectionId && collectionKind
      ? getCollectionTickersFromConfig(config, tickersBySymbol, collectionId)
      : EMPTY_TICKERS),
    [collectionId, collectionKind, config, portfolioTab, tickersBySymbol],
  );
  const collectionSymbolsKey = collectionTickers.map((ticker) => ticker.metadata.ticker).join(",");
  const financials = useTickerFinancialsMap(
    collectionTickers,
    collectionKind === "portfolio" && collectionId ? { portfolioId: collectionId } : {},
  );
  // Caps in the portfolio's currency, or the base currency for a watchlist.
  const boardCurrency = collectionKind === "portfolio"
    ? resolvePortfolioTotalsCurrency(config.portfolios.find((portfolio) => portfolio.id === collectionId), config.baseCurrency)
    : resolvePortfolioTotalsCurrency(null, config.baseCurrency);
  const trackedCurrencies = useMemo(
    () => (collectionTickers.length > 0
      ? buildTrackedCurrencies(collectionTickers, financials, null, boardCurrency)
      : NO_CURRENCIES),
    [boardCurrency, collectionTickers, financials],
  );
  const exchangeRates = useFxRatesMap(trackedCurrencies);
  // Tile areas follow prices on the portfolio pane's reorder cadence, so a
  // tick does not reshuffle the board; colors and captions stream below.
  // A snapshot arriving (the map growing) or a new list applies at once.
  const portfolioBoard = useThrottledMemo(
    () => (collectionId && collectionKind
      ? buildPortfolioHeatmapAssets({
        tickers: collectionTickers,
        financials,
        currency: boardCurrency,
        exchangeRates,
      })
      : NO_BOARD),
    [financials],
    [boardCurrency, collectionId, collectionKind, collectionTickers, exchangeRates, financials.size],
    PORTFOLIO_REORDER_THROTTLE_MS,
  );
  const portfolioAssets = portfolioBoard.assets;
  const [assets, setAssets] = useState<HeatmapBoardAsset[]>([]);
  // The universe `assets` came from. A board is drawn only under its own tab,
  // so a switch never paints the previous universe's tiles.
  const [loadedUniverse, setLoadedUniverse] = useState<MarketHeatmapUniverseId | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // The first load starts before the effect runs; an empty board is not "no data".
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Each entry is the symbol list a remainder box opened. Prices stay live
  // because the board is filtered from the latest assets, not a snapshot.
  const [drillStack, setDrillStack] = useState<string[][]>([]);
  const fetchGenRef = useRef(0);
  const seenCollection = useRef<string | null>(null);
  const boardAssets = portfolioTab ? portfolioAssets : (loadedUniverse === activeUniverse ? assets : NO_ASSETS);
  const hasBoard = boardAssets.length > 0;
  const scopedAssets = useMemo(() => {
    if (!portfolioTab || drillStack.length === 0) return boardAssets;
    const symbols = new Set(drillStack[drillStack.length - 1]);
    return boardAssets.filter((asset) => symbols.has(asset.symbol));
  }, [boardAssets, drillStack, portfolioTab]);

  const selectUniverse = useCallback((value: string) => {
    setActiveUniverse(heatmapTabId(value));
    setSelectedId(null);
  }, [setActiveUniverse]);
  // The pane's only partition: the desktop draws it in the title bar, which
  // gives the treemap the row the strip used to take.
  const tabsInHeader = usePaneHeaderTabs({
    tabs: universeTabs,
    activeValue: activeUniverse,
    onSelect: selectUniverse,
    focused,
    keyboardNavigation: false,
  });

  const chartHeight = Math.max(1, height - (tabsInHeader ? 0 : 1));
  const chartWidth = Math.max(1, width - 2);
  const cellAspect = Math.max(0.5, Math.min(4, cellHeightPx / Math.max(1, cellWidthPx)));
  const layoutMode = nativePaneChrome ? "float" : "integer";
  const foldLayout = useMemo((): HeatmapFoldLayout => ({
    width: chartWidth,
    height: chartHeight,
    cellAspect,
    mode: layoutMode,
  }), [cellAspect, chartHeight, chartWidth, layoutMode]);
  const quoteSelection = selectedId === HEATMAP_REST_ID ? null : selectedId;
  const quoteTargets = useMemo(
    () => buildScreenerQuoteTargets(scopedAssets, quoteSelection),
    [quoteSelection, scopedAssets],
  );
  const {
    entries: liveQuoteEntries,
    freshnessNow,
    subscriptionStartedAt,
  } = useLiveQuoteEntries(quoteTargets, {
    freshnessScopeKey: `market-heatmap:${activeUniverse}`,
    liveStreaming,
  });
  const resolvedAssets = useMemo(
    () => overlayScreenerQuoteEntries(scopedAssets, liveQuoteEntries),
    [liveQuoteEntries, scopedAssets],
  );
  const feedStatus = useMemo(
    () => resolveScreenerQuoteFeedStatus(quoteTargets, liveQuoteEntries, {
      now: freshnessNow,
      subscriptionStartedAt,
    }),
    [freshnessNow, liveQuoteEntries, quoteTargets, subscriptionStartedAt],
  );
  const board = useMemo(() => {
    const individuals = resolvedAssets.map((asset): HeatmapBoardEntry => ({ kind: "asset", asset }));
    if (!portfolioTab) return { entries: individuals, relaxMinimum: false };
    const folded = heatmapBoardEntries(resolvedAssets, (trial) => placeHeatmapEntries(trial, foldLayout));
    if (drillStack.length > 0 && unfoldEntireRest(resolvedAssets, folded)) {
      return { entries: individuals, relaxMinimum: true };
    }
    return { entries: folded, relaxMinimum: false };
  }, [drillStack.length, foldLayout, portfolioTab, resolvedAssets]);
  const entries = board.entries;
  const layoutOptions = board.relaxMinimum ? HEATMAP_RELAXED_LAYOUT : undefined;
  const items = useMemo(() => buildEntryItems(entries), [entries]);
  const navigationTiles = useMemo(
    () => buildMetricTreemapNavigationTiles(items, chartWidth, chartHeight, cellAspect, layoutMode, layoutOptions),
    [cellAspect, chartHeight, chartWidth, items, layoutMode, layoutOptions],
  );
  // Desktop tiles ellipsize, which is visible; terminal cells clip silently.
  const displayItems = useMemo(
    () => (nativePaneChrome ? items : fitItemsToTiles(items, navigationTiles)),
    [items, nativePaneChrome, navigationTiles],
  );
  const selectedIdx = selectedId
    ? entries.findIndex((entry) => heatmapEntryId(entry) === selectedId)
    : -1;
  const activeIdx = selectedIdx >= 0 ? selectedIdx : (entries.length > 0 ? 0 : -1);
  const selectedEntry = activeIdx >= 0 ? entries[activeIdx] ?? null : null;

  const loadUniverse = useCallback(async (universe: MarketHeatmapUniverseId, options?: { forceRefresh?: boolean }) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setLoadError(null);

    try {
      const result = await fetchMarketHeatmap(universe, {
        count: 96,
        forceRefresh: options?.forceRefresh,
      });
      if (fetchGenRef.current !== gen) return;
      setAssets(result.assets);
      setLoadedUniverse(universe);
      setLastUpdated(result.fetchedAt);
      setStale(result.stale === true);
      // Selection is the user's; the effect below only fills it when it is gone.
    } catch {
      if (fetchGenRef.current !== gen) return;
      // A failed refresh keeps the board it had; the footer says it failed.
      setLoadError(unavailableText("Market heatmap"));
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isRemoteHeatmapUniverse(activeUniverse)) return;
    void loadUniverse(activeUniverse);
  }, [activeUniverse, loadUniverse]);

  useEffect(() => {
    const previous = seenCollection.current;
    seenCollection.current = collectionId;
    if (!heatmapFollowsCollection(linkPortfolio, previous, collectionId)) return;
    setActiveUniverse(PORTFOLIO_HEATMAP_TAB);
    setSelectedId(null);
  }, [collectionId, linkPortfolio, setActiveUniverse]);

  // The financials map only reads the cache; this fills it for the list on screen.
  useEffect(() => {
    if (!portfolioTab) return;
    loadCollectionSnapshots(collectionTickers, collectionId, collectionKind);
    // Keyed by the symbols: another ticker's record changing does not reload the list.
  }, [collectionId, collectionKind, collectionSymbolsKey, portfolioTab]);

  useEffect(() => {
    setDrillStack([]);
  }, [activeUniverse, collectionId]);

  useEffect(() => {
    if (!portfolioTab || drillStack.length === 0) return;
    const symbols = new Set(drillStack[drillStack.length - 1]);
    if (boardAssets.some((asset) => symbols.has(asset.symbol))) return;
    setDrillStack((stack) => stack.slice(0, -1));
  }, [boardAssets, drillStack, portfolioTab]);

  useEffect(() => {
    if (selectedId && entries.some((entry) => heatmapEntryId(entry) === selectedId)) return;
    const foldedIn = entries.find((entry) => (
      entry.kind === "rest" && selectedId != null && entry.group.assets.some((asset) => asset.symbol === selectedId)
    ));
    setSelectedId(foldedIn ? HEATMAP_REST_ID : (entries[0] ? heatmapEntryId(entries[0]) : null));
  }, [entries, selectedId]);

  const refresh = useCallback(() => {
    if (portfolioTab) {
      loadCollectionSnapshots(collectionTickers, collectionId, collectionKind, true);
      return;
    }
    if (!isRemoteHeatmapUniverse(activeUniverse)) return;
    void loadUniverse(activeUniverse, { forceRefresh: true });
  }, [activeUniverse, collectionId, collectionKind, collectionTickers, loadUniverse, portfolioTab]);
  // The list's quotes stream; on a timer only the market boards reload.
  const autoRefresh = useCallback(() => {
    if (isRemoteHeatmapUniverse(activeUniverse)) void loadUniverse(activeUniverse, { forceRefresh: true });
  }, [activeUniverse, loadUniverse]);

  const selectAdjacentUniverse = useCallback((direction: -1 | 1) => {
    const index = universeTabs.findIndex((tab) => tab.value === activeUniverse);
    const nextTab = universeTabs[Math.max(0, Math.min(universeTabs.length - 1, index + direction))];
    if (nextTab && nextTab.value !== activeUniverse) {
      setActiveUniverse(nextTab.value);
      setSelectedId(null);
    }
  }, [activeUniverse, setActiveUniverse, universeTabs]);

  const selectUniverseAt = useCallback((index: number) => {
    const tab = universeTabs[index];
    if (!tab || tab.value === activeUniverse) return;
    setActiveUniverse(tab.value);
    setSelectedId(null);
  }, [activeUniverse, setActiveUniverse, universeTabs]);

  const openSymbol = useCallback((symbol: string) => {
    pinTicker(symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
  }, [pinTicker]);

  // A double-click is two presses. The second lands before the first DES pane exists.
  const lastActivate = useRef<{ id: string; at: number } | null>(null);
  const openEntry = useCallback((entry: HeatmapBoardEntry) => {
    const id = heatmapEntryId(entry);
    const now = Date.now();
    if (lastActivate.current?.id === id && now - lastActivate.current.at < 500) return;
    lastActivate.current = { id, at: now };
    if (entry.kind === "rest") {
      setDrillStack((stack) => [...stack, entry.group.assets.map((asset) => asset.symbol)]);
      setSelectedId(null);
      return;
    }
    openSymbol(entry.asset.symbol);
  }, [openSymbol]);

  const goBack = useCallback(() => {
    setDrillStack((stack) => stack.slice(0, -1));
    setSelectedId(HEATMAP_REST_ID);
  }, []);

  const selectIndex = useCallback((index: number) => {
    const entry = entries[index];
    if (entry) setSelectedId(heatmapEntryId(entry));
  }, [entries]);

  const selectNeighbor = useCallback((direction: MetricTreemapDirection) => {
    const target = findMetricTreemapNeighbor(navigationTiles, selectedId, direction);
    if (target) setSelectedId(target.item.id);
  }, [navigationTiles, selectedId]);

  useShortcut((event) => {
    if (!focused) return;
    if (handleRefreshKey(event, refresh, { stopPropagation: true })) return;
    if (isPlainKey(event, "1")) {
      event.preventDefault();
      event.stopPropagation();
      selectUniverseAt(0);
      return;
    }
    if (isPlainKey(event, "2")) {
      event.preventDefault();
      event.stopPropagation();
      selectUniverseAt(1);
      return;
    }
    if (isPlainKey(event, "3")) {
      event.preventDefault();
      event.stopPropagation();
      selectUniverseAt(2);
      return;
    }
    if (isPlainKey(event, "[")) {
      event.preventDefault();
      event.stopPropagation();
      selectAdjacentUniverse(-1);
      return;
    }
    if (isPlainKey(event, "]")) {
      event.preventDefault();
      event.stopPropagation();
      selectAdjacentUniverse(1);
      return;
    }
    if (isPlainKey(event, "j")) {
      event.preventDefault();
      event.stopPropagation();
      selectIndex(Math.min((activeIdx >= 0 ? activeIdx : 0) + 1, entries.length - 1));
      return;
    }
    if (isPlainKey(event, "k")) {
      event.preventDefault();
      event.stopPropagation();
      selectIndex(Math.max((activeIdx >= 0 ? activeIdx : 0) - 1, 0));
      return;
    }
    if (isPlainKey(event, "left", "h")) {
      event.preventDefault();
      event.stopPropagation();
      selectNeighbor("left");
      return;
    }
    if (isPlainKey(event, "right", "l")) {
      event.preventDefault();
      event.stopPropagation();
      selectNeighbor("right");
      return;
    }
    if (isPlainKey(event, "up")) {
      event.preventDefault();
      event.stopPropagation();
      selectNeighbor("up");
      return;
    }
    if (isPlainKey(event, "down")) {
      event.preventDefault();
      event.stopPropagation();
      selectNeighbor("down");
      return;
    }
    if (isPlainKey(event, "enter", "return") && selectedEntry) {
      event.preventDefault();
      event.stopPropagation();
      openEntry(selectedEntry);
    }
  });

  const updated = useUpdatedAgo(!portfolioTab && loadedUniverse === activeUniverse ? lastUpdated : null);
  useAutoRefresh(lastUpdated, autoRefresh);

  usePaneLoadingSignal((!portfolioTab && loading));
  usePaneStatusFooter({ registrationId: "market-heatmap-retained", stale: hasBoard && stale && !portfolioTab });
  usePaneNoticeFooter({
    registrationId: "market-heatmap-omitted",
    notices: portfolioTab && portfolioBoard.omitted > 0
      ? [tf("The {count} smallest names in {list} are left out of the map.", { count: portfolioBoard.omitted, list: portfolioLabel })]
      : [],
    focused,
  });

  usePaneFooter("market-heatmap", () => ({
    info: [
      ...(selectedEntry ? [selectedFooter(selectedEntry)] : []),
      ...(updated ? [{
        id: "updated",
        parts: [{ text: updated, tone: "muted" as const }],
      }] : []),
      // Without a board the body carries the failure.
      ...(!portfolioTab && loadError && hasBoard ? [{ id: "error", parts: [{ text: "refresh failed", tone: "warning" as const }] }] : []),
      ...(feedStatus ? [{
        id: "feed",
        parts: [{ text: feedStatus, tone: feedStatus === "live" ? "value" as const : "muted" as const }],
      }] : []),
    ],
    hints: portfolioTab && drillStack.length > 0 ? [{ id: "back", key: "b", label: "ack", onPress: goBack }] : [],
  }), [drillStack.length, feedStatus, goBack, hasBoard, loadError, loading, portfolioTab, selectedEntry, updated]);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {!tabsInHeader && (
        <Box height={1} paddingX={1}>
          <Tabs
            tabs={universeTabs}
            activeValue={activeUniverse}
            onSelect={selectUniverse}
            compact
            variant="bare"
            focused={focused}
            keyboardNavigation={false}
          />
        </Box>
      )}

      <PaneStatusBody
        loading={!portfolioTab && loading && !hasBoard}
        error={portfolioTab || hasBoard ? null : loadError}
        empty={!hasBoard}
        emptyTitle={portfolioTab ? EMPTY_PORTFOLIO_TITLE : EMPTY_TITLE}
      >
        <MetricTreemapSurface
          items={displayItems}
          width={width}
          height={chartHeight}
          selectedId={selectedEntry ? heatmapEntryId(selectedEntry) : null}
          onSelect={(item) => setSelectedId(item.id)}
          onActivate={(item) => openEntry(item.data)}
          activateOnPress
          layoutOptions={layoutOptions}
          emptyStateTitle={portfolioTab ? EMPTY_PORTFOLIO_TITLE : EMPTY_TITLE}
        />
      </PaneStatusBody>
    </Box>
  );
}

export const marketHeatmapPlugin: GloomPlugin = {
  id: "market-heatmap",
  name: "Market Heatmap",
  version: "1.0.0",
  description: "Largest US stocks and ETFs, or the portfolio pane's list, sized by market cap or position and colored by daily move",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],

  dispose() {
    resetMarketHeatmapCache();
  },

  panes: [
    {
      id: "market-heatmap",
      name: "Market Heatmap",
      icon: "H",
      component: MarketHeatmapPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 36 },
      quickSettings: [LIVE_STREAMING_QUICK_SETTING],
      settings: (context) => withLiveStreamingSetting({
        title: "Market Heatmap Settings",
        values: { linkPortfolio: context.settings.linkPortfolio === true },
        fields: [
          {
            key: "universe",
            label: "Universe",
            type: "select",
            options: [
              ...MARKET_HEATMAP_UNIVERSES.map((universe) => ({
                value: universe.id,
                label: universe.label,
              })),
              { value: PORTFOLIO_HEATMAP_TAB, label: "Portfolio pane list" },
            ],
          },
          {
            key: "linkPortfolio",
            label: "Link to portfolio",
            type: "toggle",
            description: "Open the list's tab whenever the portfolio pane switches lists.",
          },
        ] satisfies PaneSettingField[],
      }, context.settings),
    },
  ],

  paneTemplates: [
    {
      id: "market-heatmap-pane",
      paneId: "market-heatmap",
      label: "Market Heatmap",
      description: "Largest US stocks and ETFs, or the portfolio pane's list, sized by market cap or position and colored by daily move.",
      keywords: ["heatmap", "market", "largest", "top", "stocks", "etf", "portfolio", "watchlist", "screener"],
      shortcut: { prefix: "HM" },
    },
  ],
};
