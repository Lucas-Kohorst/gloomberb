import { useMemo } from "react";
import { Box } from "../../../../../ui";
import type { NewsQuery } from "../../../../../news/types";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles, useNewsTableLoadMore } from "../../../../../news/hooks";
import type { PaneProps } from "../../../../../types/plugin";
import { useDebouncedPluginPaneState } from "../../../../runtime";
import { usePaneSettingValue } from "../../../../../state/app/context";
import { Spinner } from "../../../../../components";
import { encodeSortPreference } from "../../../../../components/data-table/sort-settings";
import { NewsDetailView, useNewsArticleDetail } from "./detail-view";
import {
  NewsArticleStackView,
  type NewsColumnId,
  type NewsSortPreference,
} from "./table";
import { useNewsArticleFooter } from "./footer";
import { usePopOutNewsArticle } from "./pop-out";
import { useNewsReadState } from "../read-state";
import { usePersistedNewsArticles } from "../persisted-articles";
import { useCopyShareLink, newsArticleSharePayload } from "../../../shared/article-share";
import { getNewsPaneSettings } from "../settings";

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
  const liveHead = useMemo(() => {
    const limit = query.limit;
    if (limit == null || newsState.articles.length <= limit) return newsState.articles;
    return newsState.articles.slice(0, limit);
  }, [newsState.articles, query.limit]);
  const articles = usePersistedNewsArticles(`${paneKey}:articles`, liveHead);
  const visibleArticles = articles;
  const atLimit = query.limit != null && visibleArticles.length >= query.limit;
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(
    atLimit ? null : query,
    newsState,
  );
  const loading = newsState.phase === "loading" || (newsState.phase === "refreshing" && articles.length === 0);
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
  const popOutArticle = usePopOutNewsArticle(closeDetail);
  const copyShareLink = useCopyShareLink();
  const selectedArticle = visibleArticles.find((article) => article.id === selectedArticleId) ?? null;
  const readableArticle = detailArticle ?? selectedArticle;

  const shareArticle = readableArticle
    ? () => copyShareLink(newsArticleSharePayload(readableArticle))
    : undefined;

  useNewsArticleFooter({
    registrationId: `news-wire:${paneKey}`,
    focused,
    article: readableArticle,
    loading,
    error: newsState.error,
    onPopOut: () => popOutArticle(readableArticle),
    onRefresh: () => {
      void getSharedNewsService()?.load(query);
    },
    onShare: shareArticle,
    showPoll: !detailArticle,
  });

  const detailContent = detailArticle ? (
    <NewsDetailView
      item={detailArticle}
      focused={focused}
      width={width}
      showTitle={false}
    />
  ) : (
    <Box flexGrow={1} />
  );

  if (loading && visibleArticles.length === 0) {
    return <Spinner label={`Loading ${title.toLowerCase()}...`} />;
  }

  return (
    <NewsArticleStackView
      articles={visibleArticles}
      focused={focused}
      width={width}
      rootHeight={height}
      readArticleIds={readArticleIds}
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
      columns={effectiveColumns}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
      onPopOut={() => popOutArticle(readableArticle)}
      onShare={shareArticle}
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
