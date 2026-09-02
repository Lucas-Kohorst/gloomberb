import { Box } from "../../../../ui";
import { useEffect, useMemo } from "react";
import type { PaneProps } from "../../../../types/plugin";
import type { MarketNewsItem } from "../../../../types/news-source";
import { useLoadNewsStory, useNewsArticles, useNewsTableLoadMore } from "../../../../news/hooks";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../../runtime";
import { Tabs } from "../../../../components";
import { NewsDetailView, useNewsArticleDetail } from "./news/detail-view";
import {
  NewsArticleStackView,
  newsTableStatusContent,
  type NewsSortPreference,
} from "./news/table";
import { useNewsArticleFooter } from "./news/footer";
import { usePopOutNewsArticle } from "./news/pop-out";
import { useCopyShareLink, newsArticleSharePayload } from "../../shared/article-share";
import { useNewsReadState } from "./read-state";
import { usePersistedNewsArticles } from "./persisted-articles";
import {
  NEWS_QUERY_PRESETS,
  SECTOR_NEWS_SECTORS,
  type SectorNewsSelection,
  sectorNewsLabel,
} from "./news/query-presets";
import { getIndustryDefaultTab, getNewsPaneSettings } from "./settings";

const INDUSTRY_COLUMNS = ["time", "source", "title", "tickers", "categories"] as const;

const SECTOR_TABS = ["all", ...SECTOR_NEWS_SECTORS] as const;

const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

/**
 * The all-sector response is already fetched for the tab counts, so a sector
 * tab filters that list instead of issuing a second identical request.
 */
function useIndustryArticles(sector: SectorNewsSelection): {
  articles: MarketNewsItem[];
  allArticles: MarketNewsItem[];
  loading: boolean;
  error: string | null;
  newsState: ReturnType<typeof useNewsArticles>;
} {
  const allState = useNewsArticles(NEWS_QUERY_PRESETS.sectorAll);
  const allArticles = usePersistedNewsArticles("industry:sector:all:articles", allState.articles);
  const articles = useMemo(() => (
    sector === "all"
      ? allArticles
      : allArticles.filter((article) => (
        article.sectors.some((entry) => entry.toLowerCase() === sector)
      ))
  ), [allArticles, sector]);
  return {
    articles,
    allArticles,
    loading: allState.phase === "loading"
      || (allState.phase === "refreshing" && allArticles.length === 0),
    error: allState.error,
    newsState: allState,
  };
}

export function IndustryPane({ focused, width, height }: PaneProps) {
  const [category, setCategory] = usePaneSettingValue<SectorNewsSelection>("defaultTab", "all");
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>("industry:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("industry:sort", DEFAULT_SORT);
  const { articles, allArticles, loading, error, newsState } = useIndustryArticles(category);
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(NEWS_QUERY_PRESETS.sectorAll, newsState);
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
  const counts = useMemo(() => {
    const next: Record<string, number> = { all: allArticles.length };
    for (const cat of SECTOR_TABS) {
      if (cat !== "all") next[cat] = 0;
    }
    for (const article of allArticles) {
      for (const entry of article.sectors) {
        const key = entry.toLowerCase();
        if (key in next) next[key]!++;
      }
    }
    return next;
  }, [allArticles]);
  const tabs = useMemo(() => SECTOR_TABS.map((cat) => ({
    value: cat,
    label: counts[cat] ? `${sectorNewsLabel(cat)} ${counts[cat]}` : sectorNewsLabel(cat),
  })), [counts]);

  useEffect(() => {
    setSelectedArticleId(null);
  }, [category, setSelectedArticleId]);

  useNewsArticleFooter({
    registrationId: "news-wire:industry",
    focused,
    article: detailArticle,
    loading: loading && allArticles.length > 0,
    error,
  });

  const rootBefore = (
    <Box height={1} flexShrink={0} overflow="hidden">
      <Tabs
        tabs={tabs}
        activeValue={resolvedCategory}
        onSelect={(value) => setCategory(value as SectorNewsSelection)}
        compact
        variant="bare"
        focused={focused}
      />
    </Box>
  );

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
      setSortPreference={(preference) => setSortValue(encodeSortPreference(preference))}
      onOpenArticle={openArticle}
      onArticleRead={markArticleRead}
      detailOpen={!!detailArticle}
      onBack={closeDetail}
      detailContent={detailContent}
      detailTitle={detailArticle?.title}
      rootBefore={rootBefore}
      columns={["time", "source", "title", "tickers", "categories", "sentiment"]}
      emptyContent={newsTableStatusContent({
        loading,
        error,
        subject: "Sector news",
        emptyTitle: "No news in this category",
        emptyMessage: "Try another category or wait for the next feed refresh.",
      })}
      emptyStateTitle="No news in this category"
      emptyStateHint="Try another category or wait for the next feed refresh."
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
