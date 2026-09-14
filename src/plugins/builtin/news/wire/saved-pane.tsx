import { useCallback, useMemo, useRef, useState } from "react";
import { Box, type InputRenderable } from "../../../../ui";
import { InputSearchBar, Spinner, usePaneFooter } from "../../../../components";
import type { PaneProps } from "../../../../types/plugin";
import type { PluginModule } from "../../plugin-module";
import { t } from "../../../../i18n";
import {
  getSharedNewsService,
  useLoadNewsStory,
  useNewsArticles,
  useNewsCacheVersion,
  useNewsTableLoadMore,
} from "../../../../news/hooks";
import { MAX_ARTICLES } from "../../../../news/news-model";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../../runtime";
import { useShortcut } from "../../../../react/input";
import { NewsDetailView, useNewsArticleDetail } from "./news/detail-view";
import { NewsArticleStackView, type NewsColumnId, type NewsSortPreference } from "./news/table";
import { useNewsArticleFooter } from "./news/footer";
import { usePopOutNewsArticle } from "./news/pop-out";
import { useNewsReadState } from "./read-state";
import {
  NEWS_SAVED_PANE_TEMPLATE_ID,
  filterSavedNewsArticles,
  useNewsSavedState,
} from "./saved-state";
import { useCopyShareLink, newsArticleSharePayload } from "../../shared/article-share";
import { paneSearchHint } from "../../shared/pane-footer";
import { FIREHOSE_QUERY, filterFirehoseArticles } from "./firehose";

const SAVED_NEWS_COLUMNS: NewsColumnId[] = ["time", "source", "title", "tickers", "categories"];
const SAVED_NEWS_DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

/**
 * Saved-only view over everything the news service has loaded. Shares the
 * firehose "latest" query so opening this pane never registers a second poll,
 * then filters the merged pool down to bookmarked ids.
 */
function SavedNewsPane({ focused, width, height }: PaneProps) {
  const newsState = useNewsArticles(FIREHOSE_QUERY);
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(FIREHOSE_QUERY, newsState);
  const cacheVersion = useNewsCacheVersion(true);
  const poolArticles = useMemo(
    () => getSharedNewsService()?.getFirehose(undefined, MAX_ARTICLES) ?? [],
    [cacheVersion],
  );
  const { savedArticleIds, toggleArticleSaved } = useNewsSavedState();
  const savedArticles = useMemo(
    () => filterSavedNewsArticles(poolArticles, savedArticleIds),
    [poolArticles, savedArticleIds],
  );
  const loading = newsState.phase === "loading"
    || (newsState.phase === "refreshing" && poolArticles.length === 0);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const filteredArticles = useMemo(
    () => filterFirehoseArticles(savedArticles, searchQuery),
    [savedArticles, searchQuery],
  );

  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>(
    "saved:selectedArticleId",
    null,
  );
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>(
    "saved:sort",
    SAVED_NEWS_DEFAULT_SORT,
  );
  const loadNewsStory = useLoadNewsStory();
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(filteredArticles, loadNewsStory);
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const popOutArticle = usePopOutNewsArticle(closeDetail);
  const copyShareLink = useCopyShareLink();

  const selectedArticle = filteredArticles.find((article) => article.id === selectedArticleId) ?? null;
  const readableArticle = detailArticle ?? selectedArticle;
  const shareArticle = readableArticle
    ? () => copyShareLink(newsArticleSharePayload(readableArticle))
    : undefined;

  const refresh = useCallback(() => {
    void getSharedNewsService()?.load(FIREHOSE_QUERY);
  }, []);

  useNewsArticleFooter({
    registrationId: "news-wire:saved",
    focused: focused && !searchFocused,
    article: readableArticle,
    loading,
    error: newsState.error,
    onPopOut: () => popOutArticle(readableArticle),
    onRefresh: refresh,
    onShare: shareArticle,
    onRead: readableArticle ? () => markArticleRead(readableArticle.id) : undefined,
    onBookmark: toggleArticleSaved,
    showPoll: !detailArticle,
    updatedAt: newsState.updatedAt,
  });

  // [/] search hint — separate registration so it combines with the article footer.
  usePaneFooter("news-wire:saved:search", () => ({
    order: -1,
    hints: [paneSearchHint(focusSearch)],
  }), [focusSearch]);

  // Bind the registered search hint; footer hint bindings do not cover it.
  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !searchFocused });

  const detailContent = detailArticle ? (
    <NewsDetailView
      item={detailArticle}
      focused={focused && !searchFocused}
      width={width}
      showTitle={false}
    />
  ) : (
    <Box flexGrow={1} />
  );

  if (loading && filteredArticles.length === 0) {
    return <Spinner label={t("Loading saved stories...")} />;
  }

  return (
    <NewsArticleStackView
      articles={filteredArticles}
      focused={focused && !searchFocused}
      width={width}
      rootHeight={height}
      readArticleIds={readArticleIds}
      savedArticleIds={savedArticleIds}
      onToggleSaved={toggleArticleSaved}
      selectedArticleId={selectedArticleId}
      setSelectedArticleId={setSelectedArticleId}
      sortPreference={sortPreference}
      setSortPreference={setSortPreference}
      onOpenArticle={openArticle}
      onArticleRead={markArticleRead}
      detailOpen={!!detailArticle}
      onBack={closeDetail}
      detailContent={detailContent}
      detailTitle={detailArticle?.title}
      columns={SAVED_NEWS_COLUMNS}
      rootBefore={
        <InputSearchBar
          value={searchQuery}
          focused={focused}
          active={searchFocused}
          width={width}
          focusToken={searchFocusToken}
          inputRef={searchInputRef}
          placeholder={t("search bookmarks")}
          debounceMs={80}
          onFocus={focusSearch}
          onBlur={blurSearch}
          onNavigateDown={blurSearch}
          onQueryChange={setSearchQuery}
        />
      }
      emptyStateTitle={searchQuery.trim()
        ? t("No matching saved stories.")
        : t("No saved stories yet")}
      emptyStateHint={searchQuery.trim()
        ? t("Clear the search to see every bookmark.")
        : t("Press b on any news story to bookmark it for later.")}
    />
  );
}

export const savedNewsModule: PluginModule = {
  panes: [
    {
      id: "news-saved",
      name: "Saved News",
      icon: "★",
      component: SavedNewsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
    },
  ],
  paneTemplates: [
    {
      id: NEWS_SAVED_PANE_TEMPLATE_ID,
      paneId: "news-saved",
      label: "Saved News",
      description: "Bookmarked stories from every news pane — press b on any headline to save it for later. Searchable, opens the shared article reader.",
      keywords: ["saved", "bookmark", "bookmarks", "star", "starred", "read later", "save", "news", "stories", "articles"],
      shortcut: { prefix: "SVD" },
    },
  ],
};
