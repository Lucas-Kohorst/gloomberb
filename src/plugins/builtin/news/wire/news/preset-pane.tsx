import { useCallback } from "react";
import { Box } from "../../../../../ui";
import type { NewsQuery } from "../../../../../news/types";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles, useNewsTableLoadMore } from "../../../../../news/hooks";
import type { PaneProps } from "../../../../../types/plugin";
import { useDebouncedPluginPaneState } from "../../../../runtime";
import { PaneListChrome } from "../../../../../components";
import { NewsDetailView, useNewsArticleDetail } from "./detail-view";
import {
  NewsArticleStackView,
  newsTableStatusContent,
  type NewsColumnId,
  type NewsSortPreference,
} from "./table";
import { useNewsArticleFooter } from "./footer";
import { newsListSearchEmptyCopy, useNewsListSearch } from "./list-search";
import { usePopOutNewsArticle } from "./pop-out";
import { useNewsReadState } from "../read-state";
import { useNewsSavedState } from "../saved-state";
import { usePersistedNewsArticles } from "../persisted-articles";
import { useCopyShareLink, newsArticleSharePayload } from "../../../shared/article-share";
import { getNewsPaneSettings } from "../settings";
import { encodeSortPreference } from "../../../../../components/data-table/sort-settings";
import { usePaneSettingValue } from "../../../../../state/app/context";

export function NewsPresetPane({
  focused,
  width,
  height,
  paneKey,
  title,
  query,
  columns,
  defaultSort,
  emptyStateTitle,
  emptyStateHint,
}: PaneProps & {
  paneKey: string;
  title: string;
  query: NewsQuery;
  columns: NewsColumnId[];
  defaultSort: NewsSortPreference;
  emptyStateTitle: string;
  emptyStateHint: string;
}) {
  const newsState = useNewsArticles(query);
  const articles = usePersistedNewsArticles(`${paneKey}:articles`, newsState.articles);
  const {
    searchQuery,
    searchFocused,
    filteredArticles,
    search,
    handleRootKeyDown,
  } = useNewsListSearch(articles, {
    registrationId: `news-wire:${paneKey}`,
    focused,
  });
  const visibleArticles = filteredArticles;
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(query, newsState);
  // The aggregator opens a query in "loading", so the first paint is a loading
  // body rather than a definitive empty wire.
  const loading = newsState.phase === "loading"
    || (newsState.phase === "refreshing" && articles.length === 0);
  const error = newsState.error;
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>(
    `${paneKey}:selectedArticleId`,
    null,
  );
  const [columnIds] = usePaneSettingValue<unknown>("columnIds", columns);
  const [sortValue, setSortValue] = usePaneSettingValue<unknown>("sort", encodeSortPreference(defaultSort));
  const paneSettings = getNewsPaneSettings({ columnIds, sort: sortValue }, { columns, sort: defaultSort });
  const visibleColumns = paneSettings.columnIds.filter((columnId) => columns.includes(columnId));
  const effectiveColumns = visibleColumns.length > 0 ? visibleColumns : columns;
  const effectiveSortPreference = effectiveColumns.includes(paneSettings.sort.columnId)
    ? paneSettings.sort
    : defaultSort;
  const loadNewsStory = useLoadNewsStory();
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(visibleArticles, loadNewsStory);
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const { savedArticleIds, toggleArticleSaved } = useNewsSavedState();
  const popOutArticle = usePopOutNewsArticle(closeDetail);
  const copyShareLink = useCopyShareLink();
  const selectedArticle = visibleArticles.find((article) => article.id === selectedArticleId) ?? null;
  const readableArticle = detailArticle ?? selectedArticle;

  const shareArticle = readableArticle
    ? () => copyShareLink(newsArticleSharePayload(readableArticle))
    : undefined;

  const refresh = useCallback(() => {
    void getSharedNewsService()?.load(query);
  }, [query]);

  useNewsArticleFooter({
    registrationId: `news-wire:${paneKey}`,
    focused: focused && !searchFocused,
    article: readableArticle,
    loading: loading && articles.length > 0,
    error,
    onPopOut: () => popOutArticle(readableArticle),
    onRefresh: refresh,
    onShare: shareArticle,
    onRead: readableArticle ? () => markArticleRead(readableArticle.id) : undefined,
    onBookmark: toggleArticleSaved,
    updatedAt: newsState.updatedAt,
    showPoll: !detailArticle,
  });

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

  const emptyCopy = newsListSearchEmptyCopy(searchQuery, {
    title: emptyStateTitle,
    hint: emptyStateHint,
  });

  return (
    <NewsArticleStackView
      articles={visibleArticles}
      focused={focused && !searchFocused}
      width={width}
      rootHeight={height}
      readArticleIds={readArticleIds}
      savedArticleIds={savedArticleIds}
      onToggleSaved={toggleArticleSaved}
      selectedArticleId={selectedArticleId}
      setSelectedArticleId={setSelectedArticleId}
      sortPreference={effectiveSortPreference}
      setSortPreference={(preference) => setSortValue(encodeSortPreference(preference))}
      onOpenArticle={openArticle}
      onArticleRead={markArticleRead}
      detailOpen={!!detailArticle}
      onBack={closeDetail}
      detailContent={detailContent}
      detailTitle={detailArticle?.title}
      columns={columns}
      rootBefore={(
        <PaneListChrome
          width={width}
          focused={focused}
          search={search}
        />
      )}
      onRootKeyDown={handleRootKeyDown}
      emptyContent={newsTableStatusContent({
        loading,
        error,
        subject: title,
        emptyTitle: emptyCopy.title,
        emptyMessage: emptyCopy.hint,
      })}
      emptyStateTitle={emptyCopy.title}
      emptyStateHint={emptyCopy.hint}
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
      onPopOut={() => popOutArticle(readableArticle)}
      onShare={shareArticle}
    />
  );
}
