import { useEffect, useState } from "react";
import { Box } from "../../../ui";
import { composeBuiltinPlugin, type PluginModule } from "../plugin-module";
import { usePaneTicker } from "../../../state/app/context";
import type { TickerResearchTabPrefetchContext } from "../../../types/plugin";
import { useArticleSummary, useResolvedEntryValue } from "../../../market-data/hooks";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { EmptyState } from "../../../components";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles, useNewsTableLoadMore } from "../../../news/hooks";
import type { NewsArticle } from "../../../news/types";
import { newsWireModule } from "./wire";
import { firehoseModule } from "./wire/firehose";
import { NewsDetailView, useNewsArticleDetail } from "./wire/news/detail-view";
import { usePopOutNewsArticle } from "./wire/news/pop-out";
import {
  NewsArticleStackView,
  newsTableStatusContent,
  type NewsSortPreference,
} from "./wire/news/table";
import { useNewsArticleFooter } from "./wire/news/footer";
import { usePersistedNewsArticles } from "./wire/persisted-articles";
import { useNewsReadState } from "./wire/read-state";
import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { loadRelatedNews } from "./wire/related-news-cache";

const NEWS_ITEM_LIMIT = 50;
const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

async function prefetchTickerNews({ ticker }: TickerResearchTabPrefetchContext): Promise<void> {
  if (isEquityResearchTicker(ticker)) {
    const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
    if (!instrument) return;
    await getSharedNewsService()?.load({
      feed: "ticker",
      ticker: instrument.symbol,
      exchange: instrument.exchange,
      tickerTier: "primary",
      limit: NEWS_ITEM_LIMIT,
    });
    return;
  }
  const relatedQuery = ticker.metadata.name.trim() || ticker.metadata.ticker;
  await loadRelatedNews(relatedQuery);
}

function TickerNewsView({ width, height, focused }: { width: number; height: number; focused: boolean }) {
  const { ticker } = usePaneTicker();
  const equityNews = isEquityResearchTicker(ticker);
  const symbol = ticker?.metadata.ticker ?? "none";
  const [relatedArticles, setRelatedArticles] = useState<NewsArticle[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const relatedQuery = !equityNews && ticker
    ? (ticker.metadata.name.trim() || ticker.metadata.ticker)
    : null;

  useEffect(() => {
    if (!relatedQuery) {
      setRelatedArticles([]);
      return;
    }
    let cancelled = false;
    setRelatedLoading(true);
    void loadRelatedNews(relatedQuery).then((articles) => {
      if (cancelled) return;
      setRelatedArticles(articles);
      setLastUpdated(Date.now());
      setRelatedLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setRelatedLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [relatedQuery]);
  const [selectedArticleId, setSelectedArticleId] = useDebouncedPluginPaneState<string | null>(
    `selectedArticleId:${symbol}`,
    null,
  );
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>(
    "ticker-news:sort",
    DEFAULT_SORT,
  );
  const instrument = instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null);
  const newsQuery = equityNews && instrument ? {
    feed: "ticker" as const,
    ticker: instrument.symbol,
    exchange: instrument.exchange,
    tickerTier: "primary" as const,
    limit: NEWS_ITEM_LIMIT,
  } : null;
  const newsState = useNewsArticles(newsQuery);
  const tickerNews = usePersistedNewsArticles(
    `articles:${instrument?.symbol ?? "none"}:${instrument?.exchange ?? ""}`,
    newsState.articles,
  );
  const news = equityNews ? tickerNews : relatedArticles;
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(newsQuery, newsState);
  const loadNewsStory = useLoadNewsStory();
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(news, loadNewsStory);
  const loading = equityNews
    ? newsState.phase === "loading" || (newsState.phase === "refreshing" && news.length === 0)
    : relatedLoading && news.length === 0;
  const error = equityNews ? newsState.error : null;
  const popOutArticle = usePopOutNewsArticle();

  useEffect(() => {
    if (newsState.phase === "ready" || newsState.phase === "refreshing") {
      setLastUpdated(Date.now());
    }
  }, [news.length, newsState.phase]);

  const articleSummaryEntry = useArticleSummary(
    detailArticle && !detailArticle.summary ? detailArticle.url : null,
  );
  const fetchedSummary = useResolvedEntryValue(articleSummaryEntry);
  const loadingSummary = articleSummaryEntry?.phase === "loading"
    || articleSummaryEntry?.phase === "refreshing";
  const detailWithSummary = detailArticle && !detailArticle.summary && fetchedSummary
    ? { ...detailArticle, summary: fetchedSummary }
    : detailArticle;
  const selectedArticle = news.find((article) => article.id === selectedArticleId) ?? null;
  const readableArticle = detailWithSummary ?? selectedArticle;

  useNewsArticleFooter({
    registrationId: "news",
    focused,
    article: readableArticle,
    loading: loading && news.length > 0,
    error,
    info: [
      ...(loadingSummary ? [{ id: "summary", parts: [{ text: "summary loading", tone: "muted" as const }] }] : []),
    ],
    updatedAt: equityNews ? newsState.updatedAt : lastUpdated,
    onPopOut: () => popOutArticle(readableArticle),
    onRead: readableArticle ? () => markArticleRead(readableArticle.id) : undefined,
    onRefresh: equityNews && instrument
      ? () => {
        void getSharedNewsService()?.load({
          feed: "ticker",
          ticker: instrument.symbol,
          exchange: instrument.exchange,
          tickerTier: "primary",
          limit: NEWS_ITEM_LIMIT,
        });
      }
      : relatedQuery
        ? () => {
          setRelatedLoading(true);
          void loadRelatedNews(relatedQuery, true).then((articles) => {
            setRelatedArticles(articles);
            setRelatedLoading(false);
          }).catch(() => setRelatedLoading(false));
        }
        : undefined,
    showPoll: !detailWithSummary,
  });

  if (!ticker) {
    return (
      <Box paddingX={1} paddingY={1}>
        <EmptyState title="No ticker selected." message="Pick a ticker to load its news." />
      </Box>
    );
  }

  return (
    <NewsArticleStackView
      articles={news}
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
      detailOpen={!!detailWithSummary}
      onBack={closeDetail}
      detailContent={detailWithSummary ? (
        <NewsDetailView
          item={detailWithSummary}
          focused={focused}
          width={width}
          showTitle={false}
        />
      ) : (
        <Box flexGrow={1} />
      )}
      detailTitle={detailWithSummary?.title}
      columns={["time", "source", "title", "categories", "sentiment"]}
      emptyContent={newsTableStatusContent({
        loading,
        error,
        subject: "News",
        ticker: ticker.metadata.ticker,
        emptyTitle: `No news for ${ticker.metadata.ticker}`,
        emptyMessage: "Stories appear as sources publish them.",
      })}
      emptyStateTitle={`No news for ${ticker.metadata.ticker}`}
      emptyStateHint="Stories appear as sources publish them."
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
      onPopOut={() => popOutArticle(readableArticle)}
    />
  );
}

export const tickerNewsModule: PluginModule = {
  panes: [
    {
      id: "ticker-news",
      name: "Ticker News",
      icon: "C",
      component: TickerNewsView,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "ticker-news-pane",
      paneId: "ticker-news",
      label: "Ticker News",
      description: "Company news for the selected ticker.",
      keywords: ["company", "ticker", "news", "headlines", "cn"],
      shortcut: "CN",
      publicShare: true,
    }),
  ],

  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "news",
      name: "News",
      order: 40,
      component: TickerNewsView,
      prefetch: prefetchTickerNews,
    });
  },
};

export const newsPlugin = composeBuiltinPlugin({
  id: "news",
  name: "News",
  version: "1.0.0",
  description: "View latest news for each ticker",
  toggleable: true,
  modules: [tickerNewsModule, newsWireModule, firehoseModule],
});
