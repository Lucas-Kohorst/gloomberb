import { Box } from "../../../../ui";
import { useEffect, useMemo } from "react";
import type { PaneProps } from "../../../../types/plugin";
import type { MarketNewsItem } from "../../../../types/news-source";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles, useNewsTableLoadMore } from "../../../../news/hooks";
import type { NewsQueryPhase } from "../../../../news/types";
import { useDebouncedPluginPaneState } from "../../../runtime";
import { usePaneSettingValue } from "../../../../state/app/context";
import { encodeSortPreference } from "../../../../components/data-table/sort-settings";
import { Spinner, Tabs } from "../../../../components";
import { NewsDetailView, useNewsArticleDetail } from "./news/detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "./news/table";
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

function useIndustryArticles(sector: SectorNewsSelection): {
  articles: MarketNewsItem[];
  allArticles: MarketNewsItem[];
  phase: NewsQueryPhase;
  newsState: ReturnType<typeof useNewsArticles>;
} {
  const allState = useNewsArticles(NEWS_QUERY_PRESETS.sectorAll);
  const sectorState = useNewsArticles(
    sector === "all" ? null : NEWS_QUERY_PRESETS.sector(sector),
  );
  const allArticles = usePersistedNewsArticles("industry:sector:all:articles", allState.articles);
  const sectorArticles = usePersistedNewsArticles(`industry:sector:${sector}:articles`, sectorState.articles);
  const phase = sector === "all" ? allState.phase : sectorState.phase;
  return {
    articles: sector === "all" ? allArticles : sectorArticles,
    allArticles,
    phase,
    newsState: sector === "all" ? allState : sectorState,
  };
}

export function IndustryPane({ focused, width, height }: PaneProps) {
  const [category, setCategory] = usePaneSettingValue<SectorNewsSelection>("defaultTab", "all");
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>("industry:selectedArticleId", null);
  const [columnIds] = usePaneSettingValue<unknown>("columnIds", INDUSTRY_COLUMNS);
  const [sortValue, setSortValue] = usePaneSettingValue<unknown>("sort", encodeSortPreference(DEFAULT_SORT));
  const paneSettings = getNewsPaneSettings(
    { columnIds, sort: sortValue, defaultTab: category },
    { columns: INDUSTRY_COLUMNS, sort: DEFAULT_SORT },
  );
  const visibleColumns = paneSettings.columnIds.filter((columnId) => INDUSTRY_COLUMNS.includes(columnId as typeof INDUSTRY_COLUMNS[number]));
  const effectiveColumns = visibleColumns.length > 0 ? visibleColumns : [...INDUSTRY_COLUMNS];
  const sortPreference = effectiveColumns.includes(paneSettings.sort.columnId)
    ? paneSettings.sort
    : DEFAULT_SORT;
  const resolvedCategory = getIndustryDefaultTab({ defaultTab: category });
  const { articles, allArticles, phase, newsState } = useIndustryArticles(resolvedCategory);
  const loading = phase === "loading" || (phase === "refreshing" && articles.length === 0);
  const industryQuery = resolvedCategory === "all"
    ? NEWS_QUERY_PRESETS.sectorAll
    : NEWS_QUERY_PRESETS.sector(resolvedCategory);
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(industryQuery, newsState);
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
    article: readableArticle,
    loading,
    onPopOut: () => popOutArticle(readableArticle),
    onRefresh: () => {
      const query = resolvedCategory === "all" ? NEWS_QUERY_PRESETS.sectorAll : NEWS_QUERY_PRESETS.sector(resolvedCategory);
      void getSharedNewsService()?.load(query);
    },
    onShare: shareArticle,
    showPoll: !detailArticle,
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
      columns={effectiveColumns}
      emptyContent={loading && articles.length === 0 ? (
        <Box width="100%" paddingX={1} paddingY={1}>
          <Spinner label="Loading sector news..." />
        </Box>
      ) : undefined}
      emptyStateTitle="No news in this category"
      emptyStateHint="Try another category or wait for the next feed refresh."
      onPopOut={() => popOutArticle(readableArticle)}
      onShare={shareArticle}
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
