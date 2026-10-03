import { Box, useUiCapabilities } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PaneProps, TickerResearchTabDef } from "../../../types/plugin";
import { t, tf } from "../../../i18n";
import { quoteSubscriptionTargetFromTicker } from "../../../market-data/request-types";
import {
  useAppDispatch,
  useAppSelector,
  usePaneCollection,
  usePaneInstance,
  usePaneStateValue,
  usePaneTicker,
} from "../../../state/app/context";
import { useQuoteUpdates } from "../../../state/hooks/quote-streaming";
import { getCollectionName, getCollectionTickerCount } from "../../../state/selectors";
import { getSharedRegistry } from "../../registry";
import {
  EmptyState,
  PaneBodyPad,
  PaneFooterScope,
  PaneTabHeader,
  TickerEmptyState,
  usePaneFooter,
  type PaneHint,
} from "../../../components";
import { ChoiceDialog } from "../../../components/ui/choice-dialog";
import { useOptionalDialog, type PromptContext } from "../../../ui/dialog";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import { ensureDefaultWatchlist, isPredictionMarketTicker } from "../../prediction-markets/collection-watchlist";
import { getCollectionTypeFromConfig } from "../portfolio-list/pane/data";
import {
  dispatchEnsuredWatchlistConfig,
  persistWatchlistMembership,
} from "../portfolio-list/register-watchlist-asset";
import { usePaneFooterHintBindings } from "../shared/pane-footer";
import { useThrottledCommitValue } from "../../../react/use-throttled-commit-value";
import { resolveOptionsTarget } from "../../../utils/options";
import { useMarketData, usePluginAppActions, usePluginPaneActions } from "../../runtime";
import { useShortcut } from "../../../react/input";
import {
  buildVisibleTickerResearchTabs,
  getTickerResearchPaneSettings,
  resolveLockedTabId,
  splitTickerResearchTabStrip,
  TICKER_RESEARCH_MORE_TAB_VALUE,
} from "./settings";
import { TICKER_RESEARCH_BUILTIN_TABS } from "./research-tabs";
import { TICKER_RESEARCH_TAB_POP_OUT_TEMPLATE_ID } from "./tab-pop-out";
import { useLiveStreamingSetting } from "../shared/live-streaming";
import { useDelayedQuotesFooter } from "../shared/cloud-upgrade";
import {
  EMPTY_TICKER_HISTORY,
  moveTickerHistory,
  pushTickerHistory,
  tickerHistorySymbol,
  type TickerHistory,
} from "./ticker-history";

const TICKER_RESEARCH_TAB_COMMIT_DELAY_MS = 120;

function sameStringSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function registryTickerResearchTabsSnapshot(registry: ReturnType<typeof getSharedRegistry>): string {
  if (!registry) return "";
  return [...registry.tickerResearchTabs.values()]
    .map((tab) => `${tab.id}:${tab.name}:${tab.order}:${registry.getTickerResearchTabPluginId?.(tab.id) ?? ""}`)
    .join("\0");
}

function useRegistryTickerResearchTabsSnapshot(registry: ReturnType<typeof getSharedRegistry>): string {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const events = registry?.events;
    if (!events) return () => {};
    const unregisterRegistered = events.on("plugin:registered", onStoreChange);
    const unregisterUnregistered = events.on("plugin:unregistered", onStoreChange);
    return () => {
      unregisterRegistered();
      unregisterUnregistered();
    };
  }, [registry]);

  const getSnapshot = useCallback(() => registryTickerResearchTabsSnapshot(registry), [registry]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function TickerResearchPane({ focused, width, height }: PaneProps) {
  const { fractionalViewport = false } = useUiCapabilities();
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const paneInstance = usePaneInstance();
  const { symbol, ticker, financials } = usePaneTicker();
  const { selectTicker } = usePluginPaneActions();
  const { notify, createPaneFromTemplate } = usePluginAppActions();
  const dialog = useOptionalDialog();
  const liveStreaming = useLiveStreamingSetting();
  const streamingTarget = quoteSubscriptionTargetFromTicker(ticker, ticker?.metadata.ticker, "provider");
  const streamingTargets = useMemo(() => (
    streamingTarget
      ? [{
        ...streamingTarget,
        surface: "detail" as const,
        visible: true,
        selected: true,
        weight: 100,
      }]
      : []
  ), [
    streamingTarget?.symbol,
    streamingTarget?.exchange,
    streamingTarget?.route,
    streamingTarget?.context?.brokerId,
    streamingTarget?.context?.brokerInstanceId,
    streamingTarget?.context?.instrument,
  ]);
  useQuoteUpdates(streamingTargets, { liveStreaming });

  const { collectionId } = usePaneCollection();
  const dataProvider = useMarketData();
  const paneSettings = getTickerResearchPaneSettings(paneInstance?.settings);
  const [committedActiveTabId, setCommittedActiveTabId] = usePaneStateValue<string>(
    "activeTabId",
    paneSettings.defaultTabId,
  );
  const [tickerHistory, setTickerHistory] = usePaneStateValue<TickerHistory>(
    "tickerHistory",
    EMPTY_TICKER_HISTORY,
  );
  const {
    value: activeTabId,
    setValue: setActiveTabId,
  } = useThrottledCommitValue(
    committedActiveTabId,
    setCommittedActiveTabId,
    TICKER_RESEARCH_TAB_COMMIT_DELAY_MS,
    { commitPendingOnUnmount: true },
  );
  const [pluginCaptured, setPluginCaptured] = useState(false);
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(() => new Set());
  const hasOptionsChain = !!ticker
    && !isPredictionMarketTicker(ticker)
    && !!resolveOptionsTarget(ticker)?.effectiveTicker;
  const collectionTickerCount = useAppSelector((state) => getCollectionTickerCount(state, collectionId));
  const collectionName = useAppSelector((state) => getCollectionName(state, collectionId));

  // Cloud quotes are delayed on the free tier; a broker feed can still be live.
  useDelayedQuotesFooter({
    registrationId: "ticker-research-access",
    delayed: financials?.quote?.dataSource === "delayed",
    focused,
    shortcutScope: "ticker-research:upgrade",
  });

  const disabledPlugins = config.disabledPlugins;
  const registry = getSharedRegistry();
  const tickerResearchTabsSnapshot = useRegistryTickerResearchTabsSnapshot(registry);
  // Hosts that render a pane without booting the plugin registry (the desktop
  // screenshot renderer) would otherwise leave the body with no tabs at all.
  const tickerResearchTabs = useMemo<TickerResearchTabDef[]>(() => (
    registry
      ? [...registry.tickerResearchTabs.values()].filter((tab) => {
        const ownerId = registry.getTickerResearchTabPluginId?.(tab.id);
        return !ownerId || !disabledPlugins.includes(ownerId);
      })
      : TICKER_RESEARCH_BUILTIN_TABS
  ), [disabledPlugins, registry, tickerResearchTabsSnapshot]);
  const allTabs = buildVisibleTickerResearchTabs(tickerResearchTabs, ticker, financials, {
    config,
    hasOptionsChain,
  });
  const resolvedTabId = paneSettings.hideTabs
    ? resolveLockedTabId(paneSettings, allTabs)
    : (allTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : (allTabs.some((tab) => tab.id === paneSettings.defaultTabId)
        ? paneSettings.defaultTabId
        : (allTabs[0]?.id ?? "overview")));
  const tabStrip = fractionalViewport ? { inline: allTabs, overflow: [] } : splitTickerResearchTabStrip(allTabs, resolvedTabId);
  const stripTabs = [
    ...tabStrip.inline.map((tab) => ({ label: t(tab.name), value: tab.id })),
    ...(tabStrip.overflow.length > 0 ? [{ label: t("More"), value: TICKER_RESEARCH_MORE_TAB_VALUE }] : []),
  ];
  const overflowTabs = tabStrip.overflow;
  const openMoreTabs = useCallback(async () => {
    if (!dialog || overflowTabs.length === 0) return;
    const selected = await dialog.prompt<string>({
      closeOnClickOutside: true,
      content: (context: PromptContext<string>) => (
        <ChoiceDialog
          {...context}
          title={t("More research")}
          choices={overflowTabs.map((tab) => ({ id: tab.id, label: t(tab.name) }))}
          selectedChoiceId={resolvedTabId}
        />
      ),
    }).catch(() => null);
    if (selected) setActiveTabId(selected);
  }, [dialog, overflowTabs, resolvedTabId, setActiveTabId]);
  const handleTabSelect = useCallback((value: string) => {
    if (value === TICKER_RESEARCH_MORE_TAB_VALUE) {
      void openMoreTabs();
      return;
    }
    setActiveTabId(value);
  }, [openMoreTabs, setActiveTabId]);

  // Tabs own their keys: Chart binds [p]ercent and article tabs bind [p]op out
  // for the selected article, so the pane-level pop-out yields to them.
  const [tabHintKeys, setTabHintKeys] = useState<Record<string, string>>({});
  const reportTabHints = useCallback((tabId: string, hints: readonly PaneHint[]) => {
    const keys = hints.map((hint) => hint.key.toLowerCase()).join("\0");
    setTabHintKeys((current) => (current[tabId] === keys ? current : { ...current, [tabId]: keys }));
  }, []);
  const activeTabOwnsPopOutKey = (tabHintKeys[resolvedTabId] ?? "").split("\0").includes("p");
  const activeTabName = allTabs.find((tab) => tab.id === resolvedTabId)?.name ?? resolvedTabId;
  const popOutActiveTab = useCallback(() => {
    if (!symbol) return;
    createPaneFromTemplate(TICKER_RESEARCH_TAB_POP_OUT_TEMPLATE_ID, {
      symbol,
      values: { tabId: resolvedTabId, tabName: t(activeTabName) },
    });
  }, [activeTabName, createPaneFromTemplate, resolvedTabId, symbol]);
  const canPopOutTab = !paneSettings.hideTabs && !!ticker && !activeTabOwnsPopOutKey;

  const tabBarHeight = paneSettings.hideTabs ? 0 : 1;
  const contentHeight = Math.max(1, height - tabBarHeight);
  const visibleTabIdKey = allTabs.map((tab) => tab.id).join("\0");
  const visibleTabIds = useMemo(() => new Set(allTabs.map((tab) => tab.id)), [visibleTabIdKey]);
  const renderedTabIds = useMemo(() => {
    const next = new Set<string>();
    for (const tabId of mountedTabIds) {
      if (visibleTabIds.has(tabId)) next.add(tabId);
    }
    if (visibleTabIds.has(resolvedTabId)) {
      next.add(resolvedTabId);
    }
    return next;
  }, [mountedTabIds, resolvedTabId, visibleTabIds]);
  const prefetchedTabKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (!symbol) return;
    setTickerHistory((current) => pushTickerHistory(current, symbol));
  }, [setTickerHistory, symbol]);

  const navigateTickerHistory = useCallback((offset: -1 | 1) => {
    const nextHistory = moveTickerHistory(tickerHistory, offset);
    const nextSymbol = tickerHistorySymbol(nextHistory);
    if (nextHistory === tickerHistory || !nextSymbol) return;
    setTickerHistory(nextHistory);
    selectTicker(nextSymbol, paneInstance?.instanceId);
  }, [paneInstance?.instanceId, selectTicker, setTickerHistory, tickerHistory]);

  useShortcut((event) => {
    if (!focused || pluginCaptured || event.targetEditable) return;
    if (event.ctrl || event.meta || event.alt || event.super) return;
    const key = event.name ?? event.key ?? event.sequence;
    if (key === "[") {
      event.preventDefault();
      event.stopPropagation();
      navigateTickerHistory(-1);
    } else if (key === "]") {
      event.preventDefault();
      event.stopPropagation();
      navigateTickerHistory(1);
    }
  }, { enabled: focused && !pluginCaptured, phase: "before" });

  const handlePluginCapture = useCallback((capturing: boolean) => {
    setPluginCaptured(capturing);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: capturing });
  }, [dispatch]);
  const ignorePluginCapture = useCallback(() => {}, []);

  useEffect(() => {
    setPluginCaptured(false);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [resolvedTabId, dispatch]);

  useEffect(() => {
    if (!ticker) return;
    for (const tab of tickerResearchTabs) {
      if (!tab.prefetch) continue;
      if (!visibleTabIds.has(tab.id)) continue;
      const key = `${ticker.metadata.ticker}:${ticker.metadata.exchange ?? ""}:${tab.id}`;
      if (prefetchedTabKeysRef.current.has(key)) continue;
      prefetchedTabKeysRef.current.add(key);
      try {
        void Promise.resolve(tab.prefetch({
          config,
          dataProvider,
          ticker,
          financials,
          hasOptionsChain,
        })).catch(() => {});
      } catch {
        // Prefetching must never prevent the selected tab from rendering.
      }
    }
  }, [config, dataProvider, financials, hasOptionsChain, ticker, tickerResearchTabs, visibleTabIds]);

  useEffect(() => {
    setMountedTabIds((current) => {
      const next = new Set<string>();
      for (const tabId of current) {
        if (visibleTabIds.has(tabId)) next.add(tabId);
      }
      if (visibleTabIds.has(resolvedTabId)) {
        next.add(resolvedTabId);
      }
      return sameStringSet(current, next) ? current : next;
    });
  }, [resolvedTabId, visibleTabIds]);

  const watchlistTarget = useMemo(() => {
    const collectionType = collectionId ? getCollectionTypeFromConfig(config, collectionId) : null;
    if (collectionType === "watchlist" && collectionId) {
      return { config, watchlistId: collectionId };
    }
    return ensureDefaultWatchlist(config);
  }, [collectionId, config]);
  const alreadyOnWatchlist = !!ticker && ticker.metadata.watchlists.includes(watchlistTarget.watchlistId);
  const addTickerToDefaultWatchlist = useCallback(() => {
    if (!ticker || alreadyOnWatchlist) return;
    const registry = getSharedRegistry();
    if (!registry) {
      notify({ type: "error", body: t("Ticker lookup unavailable.") });
      return;
    }
    dispatchEnsuredWatchlistConfig(config, watchlistTarget.config, dispatch, scheduleConfigSave);
    void persistWatchlistMembership({
      ticker,
      watchlistId: watchlistTarget.watchlistId,
      tickerRepository: registry.tickerRepository,
      dispatch,
    }).then((result) => {
      if (!result.changed) return;
      notify({
        type: "success",
        body: tf("{symbol} added to Watchlist.", { symbol: result.ticker.metadata.ticker }),
      });
    });
  }, [alreadyOnWatchlist, config, dispatch, notify, ticker, watchlistTarget]);
  const paneHints = useMemo<PaneHint[]>(() => (
    ticker
      ? [
        {
          id: "add",
          key: "a",
          label: "dd",
          onPress: addTickerToDefaultWatchlist,
          disabled: alreadyOnWatchlist,
        },
        ...(canPopOutTab
          ? [{ id: "pop-out", key: "p", label: "op out", onPress: popOutActiveTab }]
          : []),
      ]
      : []
  ), [addTickerToDefaultWatchlist, alreadyOnWatchlist, canPopOutTab, popOutActiveTab, ticker]);
  usePaneFooter(
    "ticker-research-watchlist",
    () => (paneHints.length > 0 ? { hints: paneHints, order: 0 } : null),
    [paneHints],
  );
  usePaneFooterHintBindings(focused && !pluginCaptured, paneHints);

  if (!ticker) {
    const isEmptyFollowCollection = paneInstance?.binding?.kind === "follow" && !!collectionId && collectionTickerCount === 0;
    if (isEmptyFollowCollection) {
      return (
        <PaneBodyPad>
          <EmptyState
            title="No tickers in this collection"
            message={tf("No tickers in {name}.", { name: collectionName || t("this collection") })}
          />
        </PaneBodyPad>
      );
    }

    return (
      <PaneBodyPad>
        <TickerEmptyState kind="overview" symbol={null} detail="overview" />
      </PaneBodyPad>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} overflow="clip">
      {!paneSettings.hideTabs && (
        <PaneTabHeader
          width={width}
          focused={focused && !pluginCaptured}
          tabs={stripTabs}
          activeValue={resolvedTabId}
          onSelect={handleTabSelect}
          scrollable={fractionalViewport || stripTabs.length > 8}
        />
      )}

      <Box height={contentHeight} flexGrow={1} flexBasis={0} overflow="clip">
        {tickerResearchTabs.map((tab) => {
          if (!renderedTabIds.has(tab.id) || !visibleTabIds.has(tab.id)) return null;
          const TickerResearchTab = tab.component;
          const isActive = resolvedTabId === tab.id;
          return (
            <Box
              key={tab.id}
              visible={isActive}
              flexDirection="column"
              flexGrow={1}
              flexBasis={0}
              height={contentHeight}
              overflow={tab.id === "chart" ? "clip" : "hidden"}
            >
              <PaneFooterScope active={isActive} onHintsChange={(hints) => reportTabHints(tab.id, hints)}>
                <TickerResearchTab
                  width={width}
                  height={contentHeight}
                  focused={focused && isActive}
                  onCapture={isActive ? handlePluginCapture : ignorePluginCapture}
                />
              </PaneFooterScope>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
