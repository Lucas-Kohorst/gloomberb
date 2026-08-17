import { useCallback, useMemo, useRef, useState } from "react";
import { Box, type InputRenderable } from "../../../../ui";
import {
  EmptyState,
  InputSearchBar,
  Spinner,
  usePaneFooter,
} from "../../../../components";
import type { NewsQuery, NewsArticle } from "../../../../news/types";
import { newsOriginLabel } from "../../../../news/origins";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles } from "../../../../news/hooks";
import type { PaneProps } from "../../../../types/plugin";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../../runtime";
import { useShortcut } from "../../../../react/input";
import { NewsArticleStackView, type NewsColumnId, type NewsSortPreference } from "./news/table";
import { NewsDetailView, useNewsArticleDetail } from "./news/detail-view";
import { useNewsArticleFooter } from "./news/footer";
import { usePopOutNewsArticle } from "./news/pop-out";
import { useNewsReadState } from "./read-state";
import { usePersistedNewsArticles } from "./persisted-articles";
import { useCopyShareLink, encodeNewsArticleForShare } from "../../shared/article-share";
import type { PluginModule } from "../../plugin-module";

export const FIREHOSE_QUERY: NewsQuery = { feed: "latest", limit: 200 };
const FIREHOSE_COLUMNS: NewsColumnId[] = ["time", "origin", "source", "title", "tickers", "categories"];
const FIREHOSE_DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

/**
 * Filters the merged firehose stream by a free-text query. Matches against
 * title, source, summary, tickers, topics, and categories so a single search
 * box narrows across all provenance.
 */
export function filterFirehoseArticles(
  articles: readonly NewsArticle[],
  query: string,
): NewsArticle[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...articles];
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...articles];

  return articles.filter((article) => {
    const haystack = [
      article.title,
      article.source,
      newsOriginLabel(article.origin),
      article.summary ?? "",
      ...article.tickers,
      ...article.topics,
      ...article.categories,
    ]
      .join(" ")
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

function FirehosePane({ focused, width, height }: PaneProps) {
  const newsState = useNewsArticles(FIREHOSE_QUERY);
  const articles = usePersistedNewsArticles("firehose:articles", newsState.articles);
  const loading = newsState.phase === "loading" || (newsState.phase === "refreshing" && articles.length === 0);

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

  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>(
    "firehose:selectedArticleId",
    null,
  );
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>(
    "firehose:sort",
    FIREHOSE_DEFAULT_SORT,
  );
  const effectiveSortPreference = FIREHOSE_COLUMNS.includes(sortPreference.columnId)
    ? sortPreference
    : FIREHOSE_DEFAULT_SORT;

  const loadNewsStory = useLoadNewsStory();
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles, loadNewsStory);
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const popOutArticle = usePopOutNewsArticle(closeDetail);
  const copyShareLink = useCopyShareLink();

  const filteredArticles = useMemo(
    () => filterFirehoseArticles(articles, searchQuery),
    [articles, searchQuery],
  );

  const selectedArticle = filteredArticles.find((article) => article.id === selectedArticleId) ?? null;
  const readableArticle = detailArticle ?? selectedArticle;

  const shareArticle = readableArticle
    ? () => copyShareLink(encodeNewsArticleForShare(readableArticle))
    : undefined;

  const refresh = useCallback(() => {
    void getSharedNewsService()?.load(FIREHOSE_QUERY);
  }, []);

  useNewsArticleFooter({
    registrationId: "news-wire:firehose",
    focused: focused && !searchFocused,
    article: readableArticle,
    loading,
    error: newsState.error,
    onPopOut: () => popOutArticle(readableArticle),
    onRefresh: refresh,
    onShare: shareArticle,
  });

  // [s]earch hint — separate registration so it combines with the article footer.
  usePaneFooter("news-wire:firehose:search", () => ({
    order: -1,
    hints: [{ id: "search", key: "s", label: "earch", onPress: focusSearch }],
  }), [focusSearch]);

  // [s] / [/] search shortcut — only when search is not already focused.
  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !searchFocused });

  const handleRootKeyDown = useCallback(
    (event: { name?: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
      if (event.name === "s" || event.name === "/") {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusSearch();
        return true;
      }
      return false;
    },
    [focusSearch],
  );

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

  if (loading && articles.length === 0) {
    return <Spinner label="Loading firehose..." />;
  }

  if (articles.length === 0 && newsState.error) {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        <EmptyState
          title="Error loading firehose."
          message={newsState.error}
          hint="Press r to retry all sources."
        />
      </Box>
    );
  }

  return (
    <NewsArticleStackView
      articles={filteredArticles}
      focused={focused && !searchFocused}
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
      columns={FIREHOSE_COLUMNS}
      rootBefore={
        <InputSearchBar
          value={searchQuery}
          focused={focused}
          active={searchFocused}
          width={width}
          focusToken={searchFocusToken}
          inputRef={searchInputRef}
          placeholder="filter headlines, sources, tickers…"
          debounceMs={80}
          onFocus={focusSearch}
          onBlur={blurSearch}
          onNavigateDown={blurSearch}
          onQueryChange={setSearchQuery}
        />
      }
      onRootKeyDown={handleRootKeyDown}
      onPopOut={() => popOutArticle(readableArticle)}
      onShare={shareArticle}
      emptyStateTitle={searchQuery.trim() ? "No matching articles." : "No articles yet."}
      emptyStateHint={
        searchQuery.trim()
          ? "Clear search or press r to refresh."
          : "Press r to refresh all sources."
      }
    />
  );
}

export const firehoseModule: PluginModule = {
  panes: [
    {
      id: "news-firehose",
      name: "Firehose",
      icon: "H",
      component: FirehosePane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 36 },
    },
  ],
  paneTemplates: [
    {
      id: "news-firehose-pane",
      paneId: "news-firehose",
      label: "News Firehose",
      description:
        "Every article source in one reverse-chronological stream — RSS, Adjacent, Substack, Yahoo, and Gloom Cloud. Search with [s], sort columns by clicking headers, open with [o], pop out with [p].",
      keywords: [
        "firehose",
        "news",
        "all",
        "merge",
        "stream",
        "rss",
        "substack",
        "adjacent",
        "yahoo",
        "cloud",
        "feed",
        "headlines",
        "articles",
      ],
      shortcut: { prefix: "FH" },
    },
  ],
};
