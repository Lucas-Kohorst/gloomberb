import { Box } from "../../../../../ui";
import type { PaneProps } from "../../../../../types/plugin";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles, useNewsTableLoadMore } from "../../../../../news/hooks";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../../../runtime";
import { Spinner } from "../../../../../components";
import { NewsDetailView, useNewsArticleDetail } from "../news/detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "../news/table";
import { useNewsArticleFooter } from "../news/footer";
import { usePopOutNewsArticle } from "../news/pop-out";
import { useCopyShareLink, newsArticleSharePayload } from "../../../shared/article-share";
import { NEWS_QUERY_PRESETS } from "../news/query-presets";
import { usePersistedNewsArticles } from "../persisted-articles";
import { useNewsReadState } from "../read-state";

const DEFAULT_SORT: NewsSortPreference = { columnId: "importance", direction: "desc" };

export function BreakingPane({ focused, width, height }: PaneProps) {
  const breakingState = useNewsArticles(NEWS_QUERY_PRESETS.breaking);
  const articles = usePersistedNewsArticles("breaking:articles", breakingState.articles);
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(NEWS_QUERY_PRESETS.breaking, breakingState);
  const loading = breakingState.phase === "loading" || (breakingState.phase === "refreshing" && articles.length === 0);
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>("breaking:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("breaking:sort", DEFAULT_SORT);
  const loadNewsStory = useLoadNewsStory();
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles, loadNewsStory);
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const popOutArticle = usePopOutNewsArticle(closeDetail);
  const copyShareLink = useCopyShareLink();
  const selectedArticle = articles.find((article) => article.id === selectedArticleId) ?? null;
  const readableArticle = detailArticle ?? selectedArticle;

  const shareArticle = readableArticle
    ? () => copyShareLink(newsArticleSharePayload(readableArticle))
    : undefined;

  useNewsArticleFooter({
    registrationId: "news-wire:breaking",
    focused,
    article: readableArticle,
    loading,
    error: breakingState.error,
    onPopOut: () => popOutArticle(readableArticle),
    onRefresh: () => {
      void getSharedNewsService()?.load(NEWS_QUERY_PRESETS.breaking);
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
    return <Spinner label="Loading breaking news..." />;
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
      sortPreference={sortPreference}
      setSortPreference={setSortPreference}
      onOpenArticle={openArticle}
      onArticleRead={markArticleRead}
      detailOpen={!!detailArticle}
      onBack={closeDetail}
      detailContent={detailContent}
      detailTitle={detailArticle?.title}
      columns={["time", "title", "tickers", "importance"]}
      emptyStateTitle="No breaking news"
      emptyStateHint="Breaking stories appear when high-priority headlines arrive."
      onPopOut={() => popOutArticle(readableArticle)}
      onShare={shareArticle}
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
