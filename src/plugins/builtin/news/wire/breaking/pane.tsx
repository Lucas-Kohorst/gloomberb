import { useCallback } from "react";
import { Box } from "../../../../../ui";
import type { PaneProps } from "../../../../../types/plugin";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles, useNewsTableLoadMore } from "../../../../../news/hooks";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../../../runtime";
import { PaneListChrome } from "../../../../../components";
import { NewsDetailView, useNewsArticleDetail } from "../news/detail-view";
import {
  NewsArticleStackView,
  newsTableStatusContent,
  type NewsSortPreference,
} from "../news/table";
import { useNewsArticleFooter } from "../news/footer";
import { newsListSearchEmptyCopy, useNewsListSearch } from "../news/list-search";
import { usePopOutNewsArticle } from "../news/pop-out";
import { useCopyShareLink, newsArticleSharePayload } from "../../../shared/article-share";
import { NEWS_QUERY_PRESETS } from "../news/query-presets";
import { usePersistedNewsArticles } from "../persisted-articles";
import { useNewsReadState } from "../read-state";
import { useNewsSavedState } from "../saved-state";

const DEFAULT_SORT: NewsSortPreference = { columnId: "importance", direction: "desc" };

export function BreakingPane({ focused, width, height }: PaneProps) {
  const breakingState = useNewsArticles(NEWS_QUERY_PRESETS.breaking);
  const articles = usePersistedNewsArticles("breaking:articles", breakingState.articles);
  const {
    searchQuery,
    searchFocused,
    filteredArticles,
    search,
    handleRootKeyDown,
  } = useNewsListSearch(articles, {
    registrationId: "news-wire:breaking",
    focused,
  });
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(NEWS_QUERY_PRESETS.breaking, breakingState);
  const loading = breakingState.phase === "loading"
    || (breakingState.phase === "refreshing" && articles.length === 0);
  const error = breakingState.error;
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>("breaking:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("breaking:sort", DEFAULT_SORT);
  const loadNewsStory = useLoadNewsStory();
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(filteredArticles, loadNewsStory);
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const { savedArticleIds, toggleArticleSaved } = useNewsSavedState();
  const popOutArticle = usePopOutNewsArticle(closeDetail);
  const copyShareLink = useCopyShareLink();
  const selectedArticle = filteredArticles.find((article) => article.id === selectedArticleId) ?? null;
  const readableArticle = detailArticle ?? selectedArticle;

  const shareArticle = readableArticle
    ? () => copyShareLink(newsArticleSharePayload(readableArticle))
    : undefined;

  const refresh = useCallback(() => {
    void getSharedNewsService()?.load(NEWS_QUERY_PRESETS.breaking);
  }, []);

  useNewsArticleFooter({
    registrationId: "news-wire:breaking",
    focused: focused && !searchFocused,
    article: readableArticle,
    loading: loading && articles.length > 0,
    error,
    onPopOut: () => popOutArticle(readableArticle),
    onRefresh: refresh,
    onShare: shareArticle,
    onRead: readableArticle ? () => markArticleRead(readableArticle.id) : undefined,
    onBookmark: toggleArticleSaved,
    showPoll: !detailArticle,
    updatedAt: breakingState.updatedAt,
  });

  const emptyCopy = newsListSearchEmptyCopy(searchQuery, {
    title: "No breaking news",
    hint: "Breaking stories appear when high-priority headlines arrive.",
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
      columns={["time", "source", "title", "tickers", "categories", "importance"]}
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
        subject: "Breaking news",
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
