import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, useRendererHost, type InputRenderable, type ScrollBoxRenderable } from "../../../ui";
import {
  PaneListChrome,
  paneListChromeRows,
  PaneStatusBody,
  useTableLoadMore,
  type DataTableKeyEvent,
  type PaneListSearchProps,
} from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { isPlainKey } from "../../../utils/keyboard";
import { useShortcut } from "../../../react/input";
import { useDebouncedPluginPaneState, usePluginAppActions, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { SUBSTACK_ARTICLE_READER_TEMPLATE_ID } from "../shared/article-pop-out";
import {
  clearSubstackAuth,
  getStoredSubstackAuth,
} from "./api/store";
import {
  loadSubstackArticleDetail,
  loadSubstackHome,
  loadSubstackHomeMore,
  loadSubstackPublicationFeed,
} from "./api/loaders";
import {
  SubstackAuthError,
  type SubstackAuthState,
  type SubstackCachedData,
  type SubstackHomeData,
  type SubstackPublicationFeedPage,
} from "./api/types";
import { ArticleDetail } from "./article-detail";
import { stashSubstackArticle } from "./article-stash";
import { SubstackArticleStack } from "./article-stack";
import { SubstackFeedTabs } from "./feed-tabs";
import { SubstackLoginView } from "./login-view";
import { SubstackRefreshControl } from "./refresh-control";
import {
  buildSubstackColumns,
  isSubstackSortColumnId,
  nextSubstackSort,
  publicationFromTabId,
  sortedSubstackArticles,
  tabIdForPublication,
} from "./table";
import {
  SUBSTACK_FEED_TAB_ID,
  type SubstackArticleDetail,
  type SubstackArticleSummary,
  type SubstackPublication,
  type SubstackSortColumnId,
  type SubstackSortDirection,
} from "./types";
import { getSubstackPaneSettings } from "./settings";
import { useSubstackPaneFooter } from "./pane-footer";
import {
  activeFeedStateFromSources,
  detailLoadStateFromCache,
  emptyLoadState,
  emptyPublicationFeedState,
  errorMessage,
  homeLoadStateFromCache,
  mergePublicationFeedPages,
  publicationLoadStateFromCache,
  type DetailState,
  type LoadState,
  type PublicationFeedState,
} from "./pane-state";
import { useSubstackReadState } from "./read-state";

const PUBLICATION_LOAD_MORE_THRESHOLD_ROWS = 8;
const SUBSTACK_LIST_SEARCH_PLACEHOLDER = "filter titles, publications…";

function filterSubstackArticles(
  articles: readonly SubstackArticleSummary[],
  query: string,
): SubstackArticleSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...articles];
  return articles.filter((article) => {
    const haystack = [
      article.title,
      article.publicationName,
      article.subtitle,
      article.previewText,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

export function SubstackPane({ focused, width, height }: PaneProps) {
  const rendererHost = useRendererHost();
  const { createPaneFromTemplate } = usePluginAppActions();
  const [defaultTabSetting] = usePaneSettingValue("defaultTab", SUBSTACK_FEED_TAB_ID);
  const paneSettings = getSubstackPaneSettings({ defaultTab: defaultTabSetting });
  const [auth, setAuth] = useState<SubstackAuthState | null>(() => getStoredSubstackAuth());
  const [home, setHome] = useState<LoadState<SubstackHomeData>>(homeLoadStateFromCache);
  const [publicationFeeds, setPublicationFeeds] = useState<Record<string, PublicationFeedState>>({});
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [activeTab, setActiveTab] = usePluginPaneState<string>("activeTab", paneSettings.defaultTab);
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>("selectedArticleId", null);
  const [detailOpen, setDetailOpen] = usePluginPaneState<boolean>("detailOpen", false);
  const [sort, setSort] = useState<{ columnId: SubstackSortColumnId; direction: SubstackSortDirection }>(paneSettings.sort);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const { readArticleIds, markArticleRead } = useSubstackReadState();
  const homeFetchGenRef = useRef(0);
  const publicationFetchGenRef = useRef<Record<string, number>>({});
  const detailFetchGenRef = useRef(0);
  const tableScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const handleAuthFailure = useCallback((error: unknown) => {
    if (!(error instanceof SubstackAuthError)) return false;
    clearSubstackAuth();
    setAuth(null);
    setDetailOpen(false);
    setHome((current) => ({
      ...current,
      loading: false,
      error: error.message,
    }));
    return true;
  }, [setDetailOpen]);

  const loadHome = useCallback((force = false) => {
    if (!auth) return;
    homeFetchGenRef.current += 1;
    const gen = homeFetchGenRef.current;
    setHome((current) => ({
      ...current,
      loading: !current.data || force,
      error: null,
    }));
    loadSubstackHome(force)
      .then((data) => {
        if (homeFetchGenRef.current !== gen) return;
        setHome({
          data,
          loading: false,
          error: null,
          fetchedAt: data.fetchedAt,
          stale: data.stale,
        });
      })
      .catch((loadError) => {
        if (homeFetchGenRef.current !== gen) return;
        if (handleAuthFailure(loadError)) return;
        setHome((current) => ({
          ...current,
          loading: false,
          error: errorMessage(loadError),
        }));
      });
  }, [auth, handleAuthFailure]);

  const loadHomeMore = useCallback((cursor: string) => {
    if (!auth) return;
    const gen = homeFetchGenRef.current;
    loadSubstackHomeMore(cursor)
      .then((page) => {
        if (homeFetchGenRef.current !== gen) return;
        setHome((current) => {
          if (!current.data) return current;
          const itemsById = new Map(current.data.feed.map((article) => [article.id, article]));
          for (const article of page.items) itemsById.set(article.id, article);
          return {
            ...current,
            data: {
              ...current.data,
              feed: [...itemsById.values()],
              hasMore: !!page.nextCursor,
              nextCursor: page.nextCursor,
            },
          };
        });
      })
      .catch((loadError) => {
        if (homeFetchGenRef.current !== gen) return;
        handleAuthFailure(loadError);
      });
  }, [auth, handleAuthFailure]);

  useEffect(() => {
    if (!auth) return;
    loadHome(false);
  }, [auth, loadHome]);

  const subscriptions = home.data?.subscriptions ?? [];
  const activePublication = useMemo(
    () => publicationFromTabId(activeTab, subscriptions),
    [activeTab, subscriptions],
  );
  const activePublicationTabId = activePublication ? tabIdForPublication(activePublication) : null;

  useEffect(() => {
    if (!home.data || activeTab === SUBSTACK_FEED_TAB_ID) return;
    if (!publicationFromTabId(activeTab, subscriptions)) {
      setActiveTab(SUBSTACK_FEED_TAB_ID);
      setDetailOpen(false);
    }
  }, [activeTab, home.data, setActiveTab, setDetailOpen, subscriptions]);

  const loadPublication = useCallback((publication: SubstackPublication, force = false, offset = 0) => {
    const tabId = tabIdForPublication(publication);
    const isLoadMore = offset > 0 && !force;
    const gen = (publicationFetchGenRef.current[tabId] ?? 0) + 1;
    publicationFetchGenRef.current[tabId] = gen;
    setPublicationFeeds((current) => ({
      ...current,
      [tabId]: {
        ...(current[tabId] ?? emptyPublicationFeedState()),
        loading: !isLoadMore,
        loadingMore: isLoadMore,
        error: null,
      },
    }));
    loadSubstackPublicationFeed(publication, force, offset)
      .then((entry: SubstackCachedData<SubstackPublicationFeedPage>) => {
        if (publicationFetchGenRef.current[tabId] !== gen) return;
        setPublicationFeeds((current) => ({
          ...current,
          [tabId]: (() => {
            const previous = current[tabId] ?? emptyPublicationFeedState();
            return {
              data: isLoadMore ? mergePublicationFeedPages(previous.data, entry.data) : entry.data,
              loading: false,
              loadingMore: false,
              error: null,
              fetchedAt: entry.fetchedAt,
              stale: entry.stale,
            };
          })(),
        }));
      })
      .catch((loadError) => {
        if (publicationFetchGenRef.current[tabId] !== gen) return;
        if (handleAuthFailure(loadError)) return;
        setPublicationFeeds((current) => ({
          ...current,
          [tabId]: {
            ...(current[tabId] ?? emptyPublicationFeedState()),
            loading: false,
            loadingMore: false,
            error: errorMessage(loadError),
          },
        }));
      });
  }, [handleAuthFailure]);

  useEffect(() => {
    if (!activePublication || !activePublicationTabId) return;
    const entry = publicationFeeds[activePublicationTabId];
    if (entry?.data || entry?.loading || entry?.loadingMore || entry?.error) return;
    const cached = publicationLoadStateFromCache(activePublication);
    if (cached) {
      setPublicationFeeds((current) => ({
        ...current,
        [activePublicationTabId]: cached,
      }));
      return;
    }
    loadPublication(activePublication, false);
  }, [activePublication, activePublicationTabId, loadPublication, publicationFeeds]);

  const activeFeedState = useMemo(() => activeFeedStateFromSources({
    activePublication,
    activePublicationTabId,
    publicationFeeds,
    home,
  }), [activePublication, activePublicationTabId, home, publicationFeeds]);

  const loadMoreHome = useCallback(() => {
    if (!auth || home.loading || detailOpen || !home.data?.hasMore || !home.data.nextCursor) return;
    loadHomeMore(home.data.nextCursor);
  }, [auth, detailOpen, home.data?.hasMore, home.data?.nextCursor, home.loading, loadHomeMore]);

  const loadMoreActivePublicationRows = useTableLoadMore(
    tableScrollRef,
    !detailOpen && (
      activePublication
        ? !!(publicationFeeds[activePublicationTabId ?? ""]?.data?.hasMore
          && publicationFeeds[activePublicationTabId ?? ""]?.data?.nextOffset != null
          && !publicationFeeds[activePublicationTabId ?? ""]?.loading
          && !publicationFeeds[activePublicationTabId ?? ""]?.loadingMore
          && !publicationFeeds[activePublicationTabId ?? ""]?.error)
        : !!(home.data?.hasMore && home.data.nextCursor && !home.loading)
    ),
    () => {
      if (activePublication) {
        const page = publicationFeeds[activePublicationTabId ?? ""]?.data;
        if (page?.nextOffset != null) loadPublication(activePublication, false, page.nextOffset);
        return;
      }
      loadMoreHome();
    },
    PUBLICATION_LOAD_MORE_THRESHOLD_ROWS,
  );

  const sortedRows = useMemo(() => (
    sortedSubstackArticles(activeFeedState.data ?? [], sort)
  ), [activeFeedState.data, sort]);
  const visibleRows = useMemo(
    () => filterSubstackArticles(sortedRows, searchQuery),
    [searchQuery, sortedRows],
  );

  useEffect(() => {
    loadMoreActivePublicationRows();
  }, [loadMoreActivePublicationRows, visibleRows.length]);

  const selectedIndex = selectedArticleId
    ? visibleRows.findIndex((article) => article.id === selectedArticleId)
    : -1;
  const selectedArticle = visibleRows[selectedIndex >= 0 ? selectedIndex : 0] ?? null;

  useEffect(() => {
    if (visibleRows.length === 0) {
      if (!home.loading && !activeFeedState.loading && !activeFeedState.loadingMore) {
        if (selectedArticleId !== null) setSelectedArticleId(null);
        setDetailOpen(false);
      }
      return;
    }
    if (!selectedArticleId || selectedIndex < 0) {
      setSelectedArticleId(visibleRows[0]!.id);
    }
  }, [
    activeFeedState.loading,
    activeFeedState.loadingMore,
    home.loading,
    selectedArticleId,
    selectedIndex,
    setDetailOpen,
    setSelectedArticleId,
    visibleRows,
  ]);

  const loadSelectedDetail = useCallback((article: SubstackArticleSummary, force = false) => {
    detailFetchGenRef.current += 1;
    const gen = detailFetchGenRef.current;
    setDetails((current) => ({
      ...current,
      [article.id]: {
        ...(current[article.id] ?? emptyLoadState<SubstackArticleDetail>()),
        loading: true,
        error: null,
      },
    }));
    loadSubstackArticleDetail(article, force)
      .then((entry) => {
        if (detailFetchGenRef.current !== gen) return;
        setDetails((current) => ({
          ...current,
          [article.id]: {
            data: entry.data,
            loading: false,
            error: null,
            fetchedAt: entry.fetchedAt,
            stale: entry.stale,
          },
        }));
      })
      .catch((loadError) => {
        if (detailFetchGenRef.current !== gen) return;
        if (handleAuthFailure(loadError)) return;
        setDetails((current) => ({
          ...current,
          [article.id]: {
            ...(current[article.id] ?? emptyLoadState<SubstackArticleDetail>()),
            loading: false,
            error: errorMessage(loadError),
          },
        }));
      });
  }, [handleAuthFailure]);

  useEffect(() => {
    if (!detailOpen || !selectedArticle) return;
    const existing = details[selectedArticle.id];
    if (existing?.data || existing?.loading) return;
    const cached = detailLoadStateFromCache(selectedArticle);
    if (cached) {
      setDetails((current) => ({
        ...current,
        [selectedArticle.id]: cached,
      }));
      if (!cached.stale) return;
    }
    loadSelectedDetail(selectedArticle, false);
  }, [detailOpen, details, loadSelectedDetail, selectedArticle]);

  useEffect(() => {
    if (!detailOpen) return;
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
  }, [detailOpen, selectedArticle?.id]);

  const selectTab = useCallback((tabId: string) => {
    setActiveTab(tabId);
    setDetailOpen(false);
  }, [setActiveTab, setDetailOpen]);

  const refreshActive = useCallback(() => {
    if (detailOpen && selectedArticle) {
      loadSelectedDetail(selectedArticle, true);
      return;
    }
    if (activePublication) {
      loadPublication(activePublication, true);
      return;
    }
    loadHome(true);
  }, [activePublication, detailOpen, loadHome, loadPublication, loadSelectedDetail, selectedArticle]);

  useAutoRefresh(activeFeedState.fetchedAt, refreshActive);

  const openSelectedArticle = useCallback(() => {
    if (!selectedArticle?.url) return;
    markArticleRead(selectedArticle.id);
    void rendererHost.openExternal(selectedArticle.url);
  }, [markArticleRead, rendererHost, selectedArticle]);

  const popOutArticle = useCallback(() => {
    if (!selectedArticle) return;
    stashSubstackArticle(selectedArticle);
    createPaneFromTemplate(SUBSTACK_ARTICLE_READER_TEMPLATE_ID, {
      arg: selectedArticle.id,
      values: {
        title: selectedArticle.title,
        url: selectedArticle.url ?? "",
        source: selectedArticle.publicationName ?? "",
      },
    });
    setDetailOpen(false);
  }, [createPaneFromTemplate, selectedArticle, setDetailOpen]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const handleLogin = useCallback((nextAuth: SubstackAuthState) => {
    setAuth(nextAuth);
    setActiveTab(SUBSTACK_FEED_TAB_ID);
  }, [setActiveTab]);

  const handleHeaderClick = useCallback((columnId: string) => {
    if (!isSubstackSortColumnId(columnId)) return;
    setSort((current) => nextSubstackSort(current, columnId));
  }, []);

  const scrollDetailBy = useCallback((delta: number) => {
    const scrollBox = detailScrollRef.current;
    if (!scrollBox?.viewport) return;
    const maxScrollTop = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height);
    scrollBox.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollBox.scrollTop + delta));
  }, []);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refreshActive();
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedArticle();
      return true;
    }
    if (isPlainKey(event, "p")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      popOutArticle();
      return true;
    }
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch, openSelectedArticle, popOutArticle, refreshActive]);

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "j", "down")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      scrollDetailBy(1);
      return true;
    }
    if (isPlainKey(event, "k", "up")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      scrollDetailBy(-1);
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedArticle();
      return true;
    }
    if (isPlainKey(event, "p")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      popOutArticle();
      return true;
    }
    if (isPlainKey(event, "r") && selectedArticle) {
      event.preventDefault?.();
      event.stopPropagation?.();
      loadSelectedDetail(selectedArticle, true);
      return true;
    }
    return false;
  }, [loadSelectedDetail, openSelectedArticle, popOutArticle, scrollDetailBy, selectedArticle]);

  useShortcut((event) => {
    if (!focused || searchFocused || !auth) return;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refreshActive();
    }
  }, { enabled: focused && !!auth && !searchFocused });

  const includePublication = !activePublication;
  const columns = useMemo(() => buildSubstackColumns(width, includePublication), [includePublication, width]);
  const activeDetail = selectedArticle
    ? details[selectedArticle.id] ?? emptyLoadState<SubstackArticleDetail>()
    : emptyLoadState<SubstackArticleDetail>();
  useSubstackPaneFooter({
    auth,
    focused: focused && !searchFocused,
    detailOpen,
    activeFeedState,
    activeDetail,
    selectedArticle,
    openSelectedArticle,
    popOutArticle,
    focusSearch,
  });

  const search: PaneListSearchProps = {
    value: searchQuery,
    active: searchFocused,
    focusToken: searchFocusToken,
    inputRef: searchInputRef,
    placeholder: SUBSTACK_LIST_SEARCH_PLACEHOLDER,
    debounceMs: 80,
    onFocus: focusSearch,
    onBlur: blurSearch,
    onNavigateDown: blurSearch,
    onQueryChange: setSearchQuery,
  };

  if (!auth) {
    return (
      <SubstackLoginView
        width={width}
        height={height}
        focused={focused}
        onLogin={handleLogin}
      />
    );
  }

  const tabRowHeight = 1;
  const bodyHeight = Math.max(1, height - tabRowHeight);
  const listHeight = Math.max(1, bodyHeight - paneListChromeRows({ search: true }));
  const refreshing = home.loading || !!activeFeedState.loading;

  const detailContent = selectedArticle ? (
    <ArticleDetail
      article={selectedArticle}
      detail={activeDetail.data}
      width={width}
      loading={activeDetail.loading}
      error={activeDetail.error}
      scrollRef={detailScrollRef}
      onOpenArticle={openSelectedArticle}
    />
  ) : null;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexDirection="row" height={1} width={width} alignItems="center">
        <Box flexGrow={1} minWidth={0} overflow="hidden">
          <SubstackFeedTabs
            subscriptions={subscriptions}
            activeTab={activeTab}
            focused={focused && !searchFocused}
            detailOpen={detailOpen}
            onSelect={selectTab}
          />
        </Box>
        <Box flexShrink={0} height={1} paddingRight={1}>
          <SubstackRefreshControl onRefresh={refreshActive} loading={refreshing} />
        </Box>
      </Box>
      <PaneListChrome
        width={width}
        height={bodyHeight}
        focused={focused}
        search={search}
      >
        <PaneStatusBody
          loading={home.loading && !home.data}
          error={!home.data ? home.error : null}
          subject="Substack"
          onRetry={refreshActive}
        >
          <SubstackArticleStack
            focused={focused && !searchFocused}
            detailOpen={detailOpen}
            onBack={() => setDetailOpen(false)}
            selectedArticle={selectedArticle}
            detailContent={detailContent}
            selectedArticleId={selectedArticleId}
            readArticleIds={readArticleIds}
            onActivate={(article) => {
              markArticleRead(article.id);
              setSelectedArticleId(article.id, { immediate: true });
              setDetailOpen(true);
            }}
            onSelectionChange={(id) => setSelectedArticleId(id)}
            onRootKeyDown={handleRootKeyDown}
            onDetailKeyDown={handleDetailKeyDown}
            onBodyScrollActivity={loadMoreActivePublicationRows}
            tableScrollRef={tableScrollRef}
            width={width}
            height={listHeight}
            columns={columns}
            sortedRows={visibleRows}
            activePublication={activePublication}
            activeFeedState={activeFeedState}
            sort={sort}
            onHeaderClick={handleHeaderClick}
          />
        </PaneStatusBody>
      </PaneListChrome>
    </Box>
  );
}
