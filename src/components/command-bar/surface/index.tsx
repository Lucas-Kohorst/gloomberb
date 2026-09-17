import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataProvider } from "../../../types/data-provider";
import type { AppTickerRepositoryPort } from "../../../core/app-service-ports";
import type { PluginRegistry } from "../../../plugins/registry";
import type { LayoutBounds } from "../../../plugins/pane-manager";
import { usePlanAccess } from "../../../plugins/builtin/shared/plan-access";
import { applyNewsFeedContextToAssistInventory, applyChartSeriesContextToAssistInventory, buildAssistCommandInventory } from "../assist/inventory";
import { useCommandBarAssist } from "../assist/runtime";
import { shouldAutoAskAssist, type AssistRowHandlers } from "../assist/model";
import { getSharedNewsService, useNewsArticles, useNewsCacheVersion } from "../../../news/hooks";
import {
  ARTICLE_SEARCH_QUERY,
  cachedNewsArticles,
  looksLikeArticleQuery,
  openNewsArticle,
} from "../../../plugins/builtin/news/wire/article-search";
import type { NewsArticle } from "../../../news/types";
import { getStashedNewsArticle, stashNewsArticle } from "../../../plugins/builtin/news/wire/news/article-stash";
import type { RecentCommand } from "../../../types/config";
import type { CommandBarResultDef, CommandBarSearchProvider } from "../../../types/plugin";
import { enabledNewsFeedNamesFromPluginConfig } from "../../../plugins/builtin/news/wire/feed-config";
import {
  buildArticleSearchResultItems,
  useAdjacentArticleSearch,
  useFilingArticleSearch,
} from "../routes/root/article-results";
import {
  buildPredictionMarketResultItems,
  openCommandBarPredictionInstrument,
  usePredictionInstrumentSearch,
} from "../routes/root/prediction-results";
import {
  buildRssFeedResultItems,
  buildTwitterFeedResultItems,
  MARKETPLACE_TEMPLATE_ID,
  twitterFeedsFromConfig,
  twitterFeedsFromOpenPanes,
} from "../routes/root/indexed-results";
import {
  getAvailableCommandBarSearchProviders,
  useCommandBarSearchProviders,
} from "../routes/root/search-providers";
import { openUrl } from "../../ui/external-link";
import { useChartSeriesSuggestions } from "../routes/root/series-suggestions";
import {
  buildChartSeriesAssistContext,
  type SeriesCatalogInstrument,
} from "../../../plugins/builtin/chart-composer/series-catalog";
import { hasLocalChartSeriesCatalogMatch } from "../../../plugins/builtin/chart-composer/catalog-providers";
import { DATA_CATALOG_TEMPLATE_ID } from "../../../plugins/builtin/chart-composer/catalog-inventory";
import { isMarketFieldId } from "../../../time-series/field-catalog";
import { useRouteListState } from "../routing/list-state";
import { useCommandBarRootRuntime } from "../routes/root/runtime";
import { createQuickLookTickerCandidates } from "../routes/ticker-search/results";
import { parseRootShortcutIntent, shortcutClaimsQuery } from "../routes/root/shortcuts";
import { useCommandBarThemePreview } from "../theme-preview";
import { CommandBarPanel } from "../panel";
import { useCommandBarNavigationState } from "../routing/navigation-state";
import { useCommandBarSelectionRuntime } from "../selection-runtime";
import { useCommandBarPanelRuntime } from "../panel/runtime";
import { useCommandBarRouteEffects } from "../routing/effects";
import { useCommandBarEnvironment } from "./environment";
import { useCommandBarActionRuntime } from "../action-runtime";

interface CommandBarProps {
  dataProvider: DataProvider;
  tickerRepository: AppTickerRepositoryPort;
  pluginRegistry: PluginRegistry;
  quitApp: () => void;
  onCheckForUpdates?: () => void | Promise<void>;
  onNativeOccluderChange?: (rect: LayoutBounds | null) => void;
}

function newsArticleFromPersisted(article: NonNullable<RecentCommand["article"]>): NewsArticle {
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    source: article.source,
    publishedAt: new Date(),
    topic: "",
    topics: [],
    sectors: [],
    categories: [],
    tickers: [],
    scores: {
      importance: 0,
      urgency: 0,
      marketImpact: 0,
      novelty: 0,
      confidence: 0,
    },
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
  };
}

function articleCommandId(resultId: string): string {
  return resultId.startsWith("article:") ? resultId : `article:${resultId}`;
}

export function CommandBar({
  dataProvider,
  tickerRepository,
  pluginRegistry,
  quitApp,
  onCheckForUpdates,
  onNativeOccluderChange,
}: CommandBarProps) {
  const {
    activeCollectionId,
    activeFinancials,
    activePortfolio,
    activeTickerData,
    activeTickerSymbol,
    availableCommands: allAvailableCommands,
    cellHeightPx,
    cellWidthPx,
    dispatch,
    getCommittedThemeId,
    nativeListScrollRef,
    nativePaneChrome,
    nativeWindowChrome,
    persistConfig,
    skipTickerSearchDebounceRef,
    state,
    stateRef,
    termHeight,
    termWidth,
    themePickerRef,
    titleBarOverlay,
    visibleListStateRef,
  } = useCommandBarEnvironment(pluginRegistry);
  const availableCommands = useMemo(() => onCheckForUpdates
    ? allAvailableCommands
    : allAvailableCommands.filter((command) => command.id !== "check-for-updates"), [allAvailableCommands, onCheckForUpdates]);
  const {
    applyThemePreview,
    clearThemePreview,
    commitTheme,
    restoreThemePreview,
    rootThemeBaseIdRef,
  } = useCommandBarThemePreview({
    dispatch,
    getCommittedThemeId,
    themePickerRef,
  });
  const {
    closeAll,
    currentRoute,
    currentRouteRef,
    dismissCommandBar,
    lastMainBrowseRef,
    markRootSelectionNavigated,
    popRoute,
    pushRoute,
    rootHoveredIdx,
    rootModeInfo,
    rootModeKindRef,
    rootQuery,
    rootQueryRef,
    rootSelectionNavigatedRef,
    rootSelectedItemIdRef,
    rootSelectedIdx,
    setRootHoveredIdx,
    setRootQuery,
    setRootSelectedIdx,
    setRouteStack,
    updateTopRoute,
  } = useCommandBarNavigationState({
    availableCommands,
    dispatch,
    initialQuery: state.commandBarQuery,
    restoreThemePreview,
  });

  const {
    adaptTickerSearchRouteResult,
    buildLayoutItems,
    buildPaneSettingItems,
    buildTickerSearchResultItems,
    buildWindowModeItems,
    collectionWorkflowActions,
    confirmCurrentRoute,
    createPaneTemplateItem,
    createPluginCommandItem,
    executeCollectionCommand,
    getAvailablePaneShortcutTemplates,
    getAvailablePaneTemplates,
    getAvailablePluginCommands,
    runPluginCommandDirect,
    ensureRouteFieldFocus,
    focusWorkflowField,
    getWorkflowFieldStringValue,
    getWorkflowInputRef,
    localTickerSearchResultItems,
    mapTickerSearchCandidateToResultItem,
    moveWorkflowFocus,
    nonShortcutPaneTemplateItems,
    openInlineConfirm,
    openModeRoute,
    openPaneTemplateWorkflow,
    openPluginCommandWorkflow,
    openWorkflowFieldPicker,
    paneShortcutItems,
    persistLayoutChange,
    pluginCommandItems,
    pluginCommandResultItems,
    readTickerSearchCache,
    runDirectCommand,
    runSecurityDescriptionShortcut,
    setWorkflowNativeSelectRef,
    submitWorkflowRoute,
    syncActiveWorkflowTextarea,
    tickerActionItems,
    updateWorkflowValue,
    workflowNativeSelectRefs,
    workflowScrollRef,
    writeTickerSearchCache,
  } = useCommandBarActionRuntime({
    activeCollectionId,
    activeFinancials,
    activeTickerData,
    activeTickerSymbol,
    closeAll,
    config: state.config,
    currentRoute,
    dataProvider,
    dispatch,
    focusedPaneId: state.focusedPaneId,
    onCheckForUpdates,
    persistConfig,
    pluginRegistry,
    pushRoute,
    quitApp,
    rootThemeBaseIdRef,
    setRootQuery,
    setRouteStack,
    skipTickerSearchDebounceRef,
    state,
    stateRef,
    themePickerRef,
    tickerRepository,
    tickers: state.tickers,
    updateTopRoute,
  });

  const getTickerSearchTickers = useCallback(() => stateRef.current.tickers, []);
  const hasPaneSettings = useCallback((paneId: string) => pluginRegistry.hasPaneSettings(paneId), [pluginRegistry]);

  // Recents rows reuse the ticker-search select/pin execute path so a recent
  // symbol behaves exactly like a ticker-search hit.
  const buildRecentTickerItem = useCallback((symbol: string) => {
    const ticker = state.tickers.get(symbol);
    if (!ticker) return null;
    const candidate = createQuickLookTickerCandidates([ticker])[0];
    return candidate ? mapTickerSearchCandidateToResultItem(candidate) : null;
  }, [mapTickerSearchCandidateToResultItem, state.tickers]);
  const getRecentPaneTemplate = useCallback(
    (id: string) => pluginRegistry.paneTemplates.get(id),
    [pluginRegistry],
  );
  const buildRecentArticleItem = useCallback((
    articleId: string,
    label: string,
    persistedArticle?: RecentCommand["article"],
  ) => {
    let article = getStashedNewsArticle(articleId);
    if (!article && persistedArticle) {
      article = newsArticleFromPersisted({
        ...persistedArticle,
        id: persistedArticle.id || articleId,
      });
      stashNewsArticle(article);
    }
    if (!article) return null;
    const resolved = article;
    return {
      id: `article:${resolved.id}`,
      label: label || resolved.title,
      detail: resolved.source,
      category: "Suggested",
      kind: "action" as const,
      right: "ART",
      searchText: `${resolved.title} ${resolved.source} article news`,
      action: () => {
        openNewsArticle(resolved, (templateId, options) => {
          pluginRegistry.createPaneFromTemplate(templateId, options);
        });
        closeAll({ revertThemePreview: false });
      },
    };
  }, [closeAll, pluginRegistry]);

  const rootShortcutIntent = useMemo(() => parseRootShortcutIntent({
    query: rootQuery,
    commands: availableCommands,
    pluginCommands: getAvailablePluginCommands(),
    paneTemplates: getAvailablePaneShortcutTemplates(rootQuery),
    activeTicker: activeTickerSymbol,
  }), [activeTickerSymbol, availableCommands, getAvailablePaneShortcutTemplates, getAvailablePluginCommands, rootQuery]);
  const shortcutOwnsQuery = shortcutClaimsQuery(rootShortcutIntent);

  const planAccess = usePlanAccess();
  const watchNews = looksLikeArticleQuery(rootQuery);
  const newsCacheVersion = useNewsCacheVersion(watchNews);
  const [warmingNewsCache, setWarmingNewsCache] = useState(false);
  const adjacentNews = useAdjacentArticleSearch(rootQuery);
  const filingNews = useFilingArticleSearch(rootQuery);
  const newsState = useNewsArticles(watchNews ? ARTICLE_SEARCH_QUERY : null);
  useEffect(() => {
    if (!watchNews) {
      setWarmingNewsCache(false);
      return;
    }
    if (cachedNewsArticles().length > 0) {
      setWarmingNewsCache(false);
      return;
    }
    const service = getSharedNewsService();
    if (!service) {
      setWarmingNewsCache(false);
      return;
    }
    let cancelled = false;
    setWarmingNewsCache(true);
    void service.poll(ARTICLE_SEARCH_QUERY).finally(() => {
      if (!cancelled) setWarmingNewsCache(false);
    });
    return () => {
      cancelled = true;
    };
  }, [watchNews]);
  const articleResultItems = useMemo(() => {
    const cached = cachedNewsArticles();
    const seen = new Set<string>();
    const articles = [];
    for (const article of [
      ...cached,
      ...adjacentNews.articles,
      ...filingNews.articles,
      ...newsState.articles,
    ]) {
      if (seen.has(article.id)) continue;
      seen.add(article.id);
      articles.push(article);
    }
    const stillLoading = (watchNews && (
      adjacentNews.phase === "loading"
      || newsState.phase === "loading"
      || newsState.phase === "idle"
      || (cached.length === 0 && warmingNewsCache)
    )) || (filingNews.phase === "loading" && filingNews.articles.length === 0);
    return buildArticleSearchResultItems({
      articles,
      query: rootQuery,
      phase: stillLoading ? "loading" : "ready",
      onOpen: (article) => {
        dispatch({
          type: "RECORD_COMMAND",
          id: `article:${article.id}`,
          label: article.title,
          article: {
            id: article.id,
            title: article.title,
            source: article.source,
            url: article.url,
          },
        });
        openNewsArticle(article, (templateId, options) => {
          pluginRegistry.createPaneFromTemplate(templateId, options);
        });
        closeAll({ revertThemePreview: false });
      },
    });
  }, [
    adjacentNews.articles,
    adjacentNews.phase,
    closeAll,
    dispatch,
    filingNews.articles,
    filingNews.phase,
    newsState.articles,
    newsState.phase,
    newsCacheVersion,
    pluginRegistry,
    rootQuery,
    warmingNewsCache,
  ]);
  const predictionSearch = usePredictionInstrumentSearch(
    !currentRoute && !shortcutOwnsQuery ? rootQuery : "",
  );
  const predictionResultItems = useMemo(() => buildPredictionMarketResultItems({
    markets: predictionSearch.markets,
    onOpen: (summary) => {
      openCommandBarPredictionInstrument({
        summary,
        tickers: state.tickers,
        tickerRepository,
        dispatch,
        pluginRegistry,
      });
      closeAll({ revertThemePreview: false });
    },
  }), [closeAll, dispatch, pluginRegistry, predictionSearch.markets, state.tickers, tickerRepository]);
  const catalogChartQuery = !currentRoute
    && !shortcutOwnsQuery
    && !looksLikeArticleQuery(rootQuery)
    && hasLocalChartSeriesCatalogMatch(rootQuery);
  const chartSeriesIntent = rootShortcutIntent.kind !== "none"
    && rootShortcutIntent.source === "pane-template"
    && rootShortcutIntent.argKind === "text"
    && rootShortcutIntent.prefix === "G"
    ? rootShortcutIntent
    : null;
  const correlationSeriesIntent = rootShortcutIntent.kind !== "none"
    && rootShortcutIntent.source === "pane-template"
    && rootShortcutIntent.prefix === "CORR"
    ? rootShortcutIntent
    : null;
  const chartSeriesTemplateId = chartSeriesIntent?.source === "pane-template"
    ? chartSeriesIntent.template.id
    : null;
  const chartSeriesDefaultInstrument = useMemo<SeriesCatalogInstrument>(
    () => ({
      symbol: activeTickerSymbol ?? "AAPL",
      ...(activeTickerData?.metadata.exchange ? { exchange: activeTickerData.metadata.exchange } : {}),
      ...(activeTickerData?.metadata.name ? { name: activeTickerData.metadata.name } : {}),
    }),
    [activeTickerData, activeTickerSymbol],
  );
  const chartSeriesItems = useChartSeriesSuggestions({
    argText: chartSeriesIntent?.argText
      ?? correlationSeriesIntent?.argText
      ?? (catalogChartQuery ? rootQuery : ""),
    defaultInstrument: chartSeriesDefaultInstrument,
    enabled: !currentRoute && (!!chartSeriesIntent || !!correlationSeriesIntent || catalogChartQuery),
    acceptExpression: correlationSeriesIntent
      ? (expression) => (
        expression.kind === "prediction-market"
        || expression.kind === "adjacent-index"
        || (expression.kind === "security" && isMarketFieldId(expression.fieldId))
      )
      : undefined,
    shortcutRight: correlationSeriesIntent ? "CORR" : "G",
    onRun: (expression) => {
      if (correlationSeriesIntent) {
        pluginRegistry.createPaneFromTemplate("correlation-pane", { arg: expression });
        closeAll({ revertThemePreview: false });
        return;
      }
      const templateId = chartSeriesTemplateId ?? "chart-composer-pane";
      pluginRegistry.createPaneFromTemplate(templateId, { arg: expression });
      closeAll({ revertThemePreview: false });
    },
    onOpenCatalog: correlationSeriesIntent
      ? undefined
      : (query) => {
        pluginRegistry.createPaneFromTemplate(DATA_CATALOG_TEMPLATE_ID, { arg: query });
        closeAll({ revertThemePreview: false });
      },
  });
  const buildAssistInventory = useCallback(() => applyChartSeriesContextToAssistInventory(
    applyNewsFeedContextToAssistInventory(
      buildAssistCommandInventory({
        getPluginNameForCommand: (commandId) => {
          const pluginId = pluginRegistry.getCommandPluginId(commandId);
          return pluginId ? pluginRegistry.allPlugins.get(pluginId)?.name : undefined;
        },
        commands: availableCommands,
        pluginCommands: getAvailablePluginCommands(),
        paneTemplates: getAvailablePaneTemplates(undefined, { includePromptableTickerTemplates: true }),
      }),
      enabledNewsFeedNamesFromPluginConfig(state.config.pluginConfig.news),
    ),
    buildChartSeriesAssistContext(pluginRegistry.getAvailableChartSeriesCatalogs()),
  ), [availableCommands, getAvailablePaneTemplates, getAvailablePluginCommands, pluginRegistry, state.config.pluginConfig.news, state.config.disabledPlugins, state.config.disabledSources]);
  // Only the root list asks on its own, and only for text the prefix parser
  // did not claim — otherwise the user is mid-command, not mid-question.
  const assistEnabled = planAccess.emailVerified
    || planAccess.hasProAccess
    || (planAccess.signedIn && !planAccess.accountKnown);
  const assistAutoAsk = !currentRoute
    && assistEnabled
    && shouldAutoAskAssist({ query: rootQuery, hasShortcutIntent: shortcutOwnsQuery });
  const { assistActive, assistState, askAssist, resetAssist } = useCommandBarAssist({
    autoAsk: assistAutoAsk,
    getInventory: buildAssistInventory,
    rootQuery,
  });
  // Filled in below once the selection runtime exists, so an AI candidate runs
  // through the very same submit path as text the user typed.
  const runRootQueryRef = useRef<
    ((query: string, options?: { fallbackPrefix?: string }) => void) | null
  >(null);
  /**
   * Query whose answer the user is already waiting on, set by activating the
   * "Thinking…" row. The row leads the list and holds the default selection, so
   * Enter has to mean something even before the answer is back: it claims the
   * answer, and the best candidate runs the moment it lands.
   */
  const assistPendingRunRef = useRef<string | null>(null);
  const askAssistNow = useCallback(() => {
    assistPendingRunRef.current = rootQueryRef.current.trim();
    askAssist();
  }, [askAssist, rootQueryRef]);
  useEffect(() => {
    const pendingQuery = assistPendingRunRef.current;
    if (!pendingQuery) return;
    // Still the very ask that was claimed; nothing to do until it answers.
    if (assistState.status === "loading" && assistState.query === pendingQuery) return;
    assistPendingRunRef.current = null;
    if (assistState.status !== "answered" || assistState.query !== pendingQuery) return;
    // Typing moved on, so the answer is no longer what the user is looking at.
    if (rootQueryRef.current.trim() !== pendingQuery) return;
    const candidate = assistState.candidates[0];
    if (!candidate) return;
    runRootQueryRef.current?.(
      candidate.input,
      candidate.prefix ? { fallbackPrefix: candidate.prefix } : undefined,
    );
  }, [assistState, rootQueryRef]);
  const tryRunPluginCommand = useCallback((commandId: string): boolean => {
    const command = getAvailablePluginCommands().find((c) => c.id === commandId);
    if (command?.wizard?.length) {
      openPluginCommandWorkflow(command);
      return true;
    }
    if (command) {
      void command.execute?.();
      return true;
    }
    return false;
  }, [getAvailablePluginCommands, openPluginCommandWorkflow]);
  const startAuthFlow = useCallback(() => {
    if (planAccess.signedIn && !planAccess.emailVerified) {
      if (tryRunPluginCommand("auth-resend-verification")) return;
      setRootQuery("Resend Verification Email");
      return;
    }
    if (tryRunPluginCommand("auth-login")) return;
    if (tryRunPluginCommand("auth-signup")) return;
    setRootQuery("Log In");
  }, [planAccess.emailVerified, planAccess.signedIn, setRootQuery, tryRunPluginCommand]);
  const assist = useMemo<AssistRowHandlers>(() => ({
    enabled: assistEnabled,
    signedIn: planAccess.signedIn,
    auto: assistAutoAsk && assistActive,
    state: assistState,
    onAsk: askAssistNow,
    onSignUp: startAuthFlow,
    onRunCandidate: (input: string, prefix?: string) => runRootQueryRef.current?.(
      input,
      prefix ? { fallbackPrefix: prefix } : undefined,
    ),
  }), [
    askAssistNow,
    assistActive,
    assistAutoAsk,
    assistEnabled,
    assistState,
    planAccess.signedIn,
    startAuthFlow,
  ]);

  const corpusPrefixQuery = /^\s*(ART|LAW|ETF)\b/i.test(rootQuery);
  const searchProviders = useMemo(
    () => getAvailableCommandBarSearchProviders(pluginRegistry, state.config.disabledPlugins)
      .filter((provider) => corpusPrefixQuery
        ? provider.id.startsWith("research-search:")
        : !shortcutOwnsQuery),
    [pluginRegistry, shortcutOwnsQuery, corpusPrefixQuery, state.config.disabledPlugins],
  );
  const searchProviderContext = useMemo(() => ({
    activeTicker: activeTickerSymbol,
    activeCollectionId,
  }), [activeCollectionId, activeTickerSymbol]);
  const closeAfterProviderResult = useCallback(() => {
    closeAll({ revertThemePreview: false });
  }, [closeAll]);
  const recordSearchProviderArticle = useCallback((
    result: CommandBarResultDef,
    provider: CommandBarSearchProvider,
  ) => {
    const category = (result.category ?? provider.category).trim().toLowerCase();
    if (category !== "news" && category !== "articles") return;
    const id = articleCommandId(result.id);
    dispatch({
      type: "RECORD_COMMAND",
      id,
      label: result.label,
      article: {
        id: id.slice("article:".length),
        title: result.label,
        source: result.detail ?? "",
        url: result.url ?? "",
      },
    });
  }, [dispatch]);
  const { providerResultItems, providerSearching } = useCommandBarSearchProviders({
    providers: searchProviders,
    query: rootQuery.replace(/^\s*(ART|LAW|ETF)\s+/i, ""),
    enabled: !currentRoute && (!shortcutOwnsQuery || looksLikeArticleQuery(rootQuery) || corpusPrefixQuery),
    context: searchProviderContext,
    onExecuted: closeAfterProviderResult,
    beforeExecute: recordSearchProviderArticle,
  });
  const rssFeedResultItems = useMemo(() => buildRssFeedResultItems({
    pluginConfig: state.config.pluginConfig,
    query: rootQuery,
    onOpen: () => {
      pluginRegistry.createPaneFromTemplate("news-rss-pane");
      closeAll({ revertThemePreview: false });
    },
  }), [closeAll, pluginRegistry, rootQuery, state.config.pluginConfig]);
  const twitterFeedResultItems = useMemo(() => {
    const feeds = [
      ...twitterFeedsFromConfig(state.config.pluginConfig),
      ...twitterFeedsFromOpenPanes(state.config.layout.instances),
    ];
    const openQuery = (query: string) => {
      const command = getAvailablePluginCommands().find((item) => item.id === "twitter-feed-open");
      if (command) {
        void runPluginCommandDirect(command, { query });
        return;
      }
      pluginRegistry.createPaneFromTemplate("twitter-feed-pane", {
        arg: query,
        values: { query },
      });
      closeAll({ revertThemePreview: false });
    };
    return buildTwitterFeedResultItems({
      feeds,
      query: rootQuery,
      onOpen: (feed) => openQuery(feed.query),
      onSearch: openQuery,
    });
  }, [
    closeAll,
    getAvailablePluginCommands,
    pluginRegistry,
    rootQuery,
    runPluginCommandDirect,
    state.config.layout.instances,
    state.config.pluginConfig,
  ]);
  const indexedResultItems = useMemo(() => [
    ...articleResultItems,
    ...predictionResultItems,
    ...chartSeriesItems,
    ...rssFeedResultItems,
    ...twitterFeedResultItems,
    ...providerResultItems,
  ], [
    articleResultItems,
    chartSeriesItems,
    predictionResultItems,
    providerResultItems,
    rssFeedResultItems,
    twitterFeedResultItems,
  ]);
  const openPluginMarketplace = useCallback(() => {
    pluginRegistry.createPaneFromTemplate(MARKETPLACE_TEMPLATE_ID);
    closeAll({ revertThemePreview: false });
  }, [closeAll, pluginRegistry]);
  const providerCategoryPriorities = useMemo(
    () => new Map(searchProviders.map((provider) => [provider.category, provider.priority ?? 0])),
    [searchProviders],
  );

  const {
    activeMatch,
    orderedRootResults,
    rootGhostSuffix,
    rootSearching,
    rootSectionOrder,
    rootShortcutFeedback,
    tickerSearchPending,
    tickerSearchResults,
  } = useCommandBarRootRuntime({
    activeCollectionId,
    activePortfolio,
    activeTickerData,
    activeTickerSymbol,
    assist,
    availableCommands,
    buildLayoutItems,
    buildRecentTickerItem,
    buildRecentArticleItem,
    buildPaneSettingItems,
    buildTickerSearchResultItems,
    buildWindowModeItems,
    createPaneTemplateItem,
    createPluginCommandItem,
    currentRoute,
    dataProvider,
    executeCollectionCommand,
    getAvailablePaneShortcutTemplates,
    getRecentPaneTemplate,
    getTickers: getTickerSearchTickers,
    hasPaneSettings,
    localTickerSearchResultItems,
    nativeListScrollRef,
    nonShortcutPaneTemplateItems,
    openModeRoute,
    paneShortcutItems,
    pluginCommandItems,
    pluginCommandResultItems,
    providerResultItems: indexedResultItems,
    providerCategoryPriorities,
    providerSearching,
    onOpenPluginMarketplace: openPluginMarketplace,
    readTickerSearchCache,
    rootModeKind: rootModeInfo.kind,
    rootQuery,
    rootSelectionNavigatedRef,
    rootSelectedItemIdRef,
    rootShortcutIntent,
    runDirectCommand,
    runSecurityDescriptionShortcut,
    setRootHoveredIdx,
    setRootSelectedIdx,
    skipTickerSearchDebounceRef,
    state,
    tickerActionItems,
    writeTickerSearchCache,
  });
  const themePickerActive = !currentRoute && activeMatch?.command.id === "theme";
  const themePickerFilter = themePickerActive ? activeMatch.arg : "";

  const {
    acceptRootShortcutTab,
    acceptSelectedShortcutTab,
    activateListSelection,
    runRootQuery,
    setActiveListQuery,
  } = useCommandBarSelectionRuntime({
    activeTickerSymbol,
    availableCommands,
    clearThemePreview,
    closeAll,
    collectionWorkflowActions,
    createPaneTemplateItem,
    createPluginCommandItem,
    currentRoute,
    currentRouteRef,
    executeCollectionCommand,
    getAvailablePaneShortcutTemplates,
    getAvailablePluginCommands,
    openInlineConfirm,
    openModeRoute,
    openPaneTemplateWorkflow,
    persistLayoutChange,
    pluginCommandResultItems,
    pluginRegistry,
    rootModeKindRef,
    rootQuery,
    rootQueryRef,
    rootThemeBaseIdRef,
    runDirectCommand,
    runSecurityDescriptionShortcut,
    setRootQuery,
    setRouteStack,
    stateConfigLayout: state.config.layout,
    stateRef,
    updateTopRoute,
    updateWorkflowValue,
    visibleListStateRef,
  });
  runRootQueryRef.current = runRootQuery;

  const routeListState = useRouteListState({
    activeMatch,
    adaptTickerSearchRouteResult,
    buildLayoutItems,
    buildPaneSettingItems,
    currentRoute,
    orderedRootResults,
    pluginRegistry,
    rootCategoryPriorities: providerCategoryPriorities,
    rootHoveredIdx,
    rootModeKind: rootModeInfo.kind,
    rootQuery,
    rootSectionOrder,
    rootSearching,
    rootSelectedIdx,
    tickerSearchPending,
    tickerSearchResults,
  });
  useCommandBarRouteEffects({
    clearThemePreview,
    committedThemeId: state.config.theme,
    currentRoute,
    dataProvider,
    ensureRouteFieldFocus,
    lastMainBrowseRef,
    rootModeKind: rootModeInfo.kind,
    rootQuery,
    rootSelectedIdx,
    rootThemeBaseIdRef,
    updateTopRoute,
  });

  const panelProps = useCommandBarPanelRuntime({
    acceptRootShortcutTab,
    acceptSelectedShortcutTab,
    activateListSelection,
    applyThemePreview,
    cellHeightPx,
    cellWidthPx,
    closeAll,
    commitTheme,
    committedThemeId: state.config.theme,
    confirmCurrentRoute,
    currentRoute,
    currentRouteRef,
    dismissCommandBar,
    focusWorkflowField,
    getWorkflowInputRef,
    getWorkflowFieldStringValue,
    markRootSelectionNavigated,
    moveWorkflowFocus,
    nativeListScrollRef,
    nativePaneChrome,
    nativeWindowChrome,
    onNativeOccluderChange,
    openWorkflowFieldPicker,
    persistConfig,
    pluginRegistry,
    popRoute,
    resetAssist,
    rootModeKind: rootModeInfo.kind,
    rootGhostSuffix,
    rootShortcutFeedback,
    routeListState,
    setActiveListQuery,
    setRootHoveredIdx,
    setRootSelectedIdx,
    setRouteStack,
    setWorkflowNativeSelectRef,
    stateRef,
    submitWorkflowRoute,
    syncActiveWorkflowTextarea,
    termHeight,
    termWidth,
    themePickerActive,
    themePickerFilter,
    themePickerRef,
    titleBarOverlay,
    updateTopRoute,
    updateWorkflowValue,
    visibleListStateRef,
    workflowNativeSelectRefs,
    workflowScrollRef,
  });

  return (
    <CommandBarPanel {...panelProps} />
  );
}
