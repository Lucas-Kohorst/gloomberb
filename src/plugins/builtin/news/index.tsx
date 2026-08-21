import { Text } from "../../../ui";
import { useRef, useEffect, useMemo, useState } from "react";
import { composeBuiltinPlugin, type PluginModule } from "../plugin-module";
import { usePaneTicker } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import type { NewsArticle } from "../../../types/news-source";
import { useArticleSummary, useResolvedEntryValue } from "../../../market-data/hooks";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { useDebouncedPluginPaneState } from "../../runtime";
import { usePopOutNewsArticle } from "./wire/news/pop-out";
import { EmptyState, ErrorState, FeedDataTableStackView, LoadingState, useUpdatedAgo, type FeedDataTableItem } from "../../../components";
import { shouldSkipJinaForKnownBody } from "../shared/jina-article-text";
import { useJinaArticle } from "../shared/jina-reader";
import { getSharedNewsService, useNewsArticles, useNewsTableLoadMore } from "../../../news/hooks";
import { newsWireModule } from "./wire";
import { firehoseModule } from "./wire/firehose";
import { useNewsArticleFooter } from "./wire/news/footer";
import { usePersistedNewsArticles } from "./wire/persisted-articles";
import { useNewsReadState } from "./wire/read-state";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";

const NEWS_ITEM_LIMIT = 50;

function getFeedItems(
  news: NewsArticle[],
  selectedUrl: string | undefined,
  summaryCache: Map<string, string>,
  loadingSummary: boolean,
  selectedJinaContent: string | null,
): FeedDataTableItem[] {
  return news.map((item) => {
    const preview = summaryCache.get(item.url) ?? item.summary ?? undefined;
    const isSelected = item.url === selectedUrl;
    const fallbackBody = preview ?? (loadingSummary ? "Loading preview..." : "No preview available.");
    return {
      id: item.id,
      eyebrow: item.source,
      title: item.title,
      timestamp: item.publishedAt,
      detailTitle: item.title,
      detailMeta: [
        item.source,
        item.publishedAt
          ? `Published ${item.publishedAt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}`
          : "",
      ].filter(Boolean),
      detailBody: isSelected
        ? selectedJinaContent ?? fallbackBody
        : preview ?? "",
      detailNote: item.url,
    };
  });
}

function TickerNewsView({ width, height, focused }: { width: number; height: number; focused: boolean }) {
  const { ticker } = usePaneTicker();
  const selectionKey = `selectedIdx:${ticker?.metadata.ticker ?? "none"}`;
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>(selectionKey, 0);
  const [summaryCache, setSummaryCache] = useState<Map<string, string>>(new Map());
  const summaryFetchRef = useRef(0);
  const instrument = instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null);
  const newsQuery = instrument ? {
    feed: "ticker" as const,
    ticker: instrument.symbol,
    exchange: instrument.exchange,
    tickerTier: "primary" as const,
    limit: NEWS_ITEM_LIMIT,
  } : null;
  const newsState = useNewsArticles(newsQuery);
  const liveNews = newsState.articles;
  const news = usePersistedNewsArticles(
    `articles:${instrument?.symbol ?? "none"}:${instrument?.exchange ?? ""}`,
    liveNews,
  );
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const popOutArticle = usePopOutNewsArticle(() => setOpenItemId(null));
  const loading = newsState.phase === "loading" || (newsState.phase === "refreshing" && news.length === 0);
  const error = newsState.phase === "error" ? newsState.error ?? "Failed to load news" : null;
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const { scrollRef, onBodyScrollActivity } = useNewsTableLoadMore(newsQuery, newsState);

  useEffect(() => {
    if (newsState.phase === "ready" || newsState.phase === "refreshing") {
      setLastUpdated(Date.now());
    }
  }, [liveNews.length, newsState.phase]);

  useEffect(() => {
    summaryFetchRef.current += 1;
    setSummaryCache(new Map());
  }, [ticker?.metadata.ticker]);

  const selected = news[selectedIdx];
  const openArticle = openItemId
    ? news.find((article) => article.id === openItemId) ?? null
    : null;
  const cachedSelectedSummary = selected ? summaryCache.get(selected.url) : undefined;
  const articleSummaryEntry = useArticleSummary(
    selected && !selected.summary && !cachedSelectedSummary ? selected.url : null,
  );
  const selectedSummary = useResolvedEntryValue(articleSummaryEntry);
  const loadingSummary = articleSummaryEntry?.phase === "loading" || articleSummaryEntry?.phase === "refreshing";
  const skipJina = shouldSkipJinaForKnownBody(selected?.body);
  const jina = useJinaArticle(selected?.url ?? "", !!selected?.url && !skipJina);

  useEffect(() => {
    if (!selected?.summary) return;
    const summary = selected.summary;
    setSummaryCache((prev) => prev.has(selected.url) ? prev : new Map(prev).set(selected.url, summary));
  }, [selected?.summary, selected?.url]);

  useEffect(() => {
    if (!selected?.url || !selectedSummary) return;
    setSummaryCache((prev) => new Map(prev).set(selected.url, selectedSummary));
  }, [selected?.url, selectedSummary]);

  useEffect(() => {
    if (news.length > 0 && selectedIdx >= news.length) {
      setSelectedIdx(Math.max(0, news.length - 1));
    }
  }, [news.length, selectedIdx, setSelectedIdx]);

  useNewsArticleFooter({
    registrationId: "news",
    focused,
    article: openArticle ?? selected,
    loading,
    error,
    info: [
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
      ...(loadingSummary ? [{ id: "summary", parts: [{ text: "summary loading", tone: "muted" as const }] }] : []),
      ...(jina.loading ? [{ id: "rendering", parts: [{ text: "rendering article", tone: "muted" as const }] }] : []),
    ],
    onPopOut: () => popOutArticle(openArticle ?? selected),
    onRefresh: instrument
      ? () => {
        void getSharedNewsService()?.load({
          feed: "ticker",
          ticker: instrument.symbol,
          exchange: instrument.exchange,
          tickerTier: "primary",
          limit: NEWS_ITEM_LIMIT,
        });
      }
      : undefined,
  });

  if (!ticker) return <EmptyState title="Select a ticker to view news." />;
  if (loading && news.length === 0) return <LoadingState title="Loading news..." />;
  if (error && news.length === 0) return <ErrorState error={error} />;
  if (news.length === 0) return <EmptyState title="No news available." />;

  const items = getFeedItems(news, selected?.url, summaryCache, loadingSummary, jina.content);

  return (
    <FeedDataTableStackView
      width={width}
      width={width}
      height={height}
      focused={focused}
      items={items}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      isItemRead={(item) => readArticleIds.has(item.id)}
      onOpenItem={(item) => markArticleRead(item.id)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onPopOut={(item) => popOutArticle(news.find((article) => article.id === item.id) ?? openArticle ?? selected)}
      sourceLabel="Source"
      titleLabel="Headline"
      emptyStateTitle="No news."
      markdown
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}

const tickerNewsModule: PluginModule = {
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
    }),
  ],

  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "news",
      name: "News",
      order: 40,
      component: TickerNewsView,
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
