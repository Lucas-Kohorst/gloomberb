import { Box } from "../../../../../ui";
import type { NewsQuery } from "../../../../../news/types";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles } from "../../../../../news/hooks";
import type { PaneProps } from "../../../../../types/plugin";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../../../runtime";
import { Spinner } from "../../../../../components";
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
import { useCopyShareLink, encodeNewsArticleForShare } from "../../../shared/article-share";

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
  const loading = newsState.phase === "loading" || (newsState.phase === "refreshing" && articles.length === 0);
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>(
    `${paneKey}:selectedArticleId`,
    null,
  );
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>(
    `${paneKey}:sort`,
    defaultSort,
  );
  const effectiveSortPreference = columns.includes(sortPreference.columnId)
    ? sortPreference
    : defaultSort;
  const loadNewsStory = useLoadNewsStory();
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles, loadNewsStory);
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const popOutArticle = usePopOutNewsArticle(closeDetail);
  const copyShareLink = useCopyShareLink();
  const selectedArticle = articles.find((article) => article.id === selectedArticleId) ?? null;
  const readableArticle = detailArticle ?? selectedArticle;

  const shareArticle = readableArticle
    ? () => copyShareLink(encodeNewsArticleForShare(readableArticle))
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

  if (loading && articles.length === 0) {
    return <Spinner label={`Loading ${title.toLowerCase()}...`} />;
  }

  return (
    <NewsArticleStackView
      articles={articles}
      focused={focused}
      width={width}
      rootHeight={height}
      readArticleIds={readArticleIds}
      selectedArticleId={selectedArticleId}
      setSelectedArticleId={setSelectedArticleId}
      sortPreference={effectiveSortPreference}
      setSortPreference={setSortPreference}
      onOpenArticle={openArticle}
      onArticleRead={markArticleRead}
      detailOpen={!!detailArticle}
      onBack={closeDetail}
      detailContent={detailContent}
      detailTitle={detailArticle?.title}
      columns={columns}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
      onPopOut={() => popOutArticle(readableArticle)}
      onShare={shareArticle}
    />
  );
}
