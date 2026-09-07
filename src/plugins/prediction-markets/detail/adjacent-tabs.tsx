import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box } from "../../../ui";
import { EmptyState, Spinner } from "../../../components";
import { getSharedNewsService, useLoadNewsStory, useNewsArticles } from "../../../news/hooks";
import type { NewsArticle, NewsQuery } from "../../../news/types";
import type { AdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentNewsArticle, AdjacentSimilarMarket } from "../../builtin/adjacent/types";
import { SimilarMarketsView } from "../../builtin/adjacent/prediction-integration";
import { normalizeAdjacentNewsArticle } from "../../builtin/adjacent/normalize";
import { NewsDetailView, useNewsArticleDetail } from "../../builtin/news/wire/news/detail-view";
import { useNewsArticleFooter } from "../../builtin/news/wire/news/footer";
import { usePopOutNewsArticle } from "../../builtin/news/wire/news/pop-out";
import {
  NewsArticleStackView,
  type NewsSortPreference,
} from "../../builtin/news/wire/news/table";
import { useNewsReadState } from "../../builtin/news/wire/read-state";
import { useCopyShareLink, newsArticleSharePayload } from "../../builtin/shared/article-share";
import type { PredictionMarketSummary } from "../types";
import {
  useAdjacentMarketMatch,
  type AdjacentMarketLookup,
} from "./adjacent-match";
import { buildPredictionNewsQuery } from "./news-query";
import { searchRelatedNews } from "../../builtin/news/wire/article-search";

function matchHint(triedIds: string[], subject: string): string {
  if (triedIds.length > 0) {
    const shown = triedIds.slice(0, 3).join(", ");
    const extra = triedIds.length > 3 ? ` +${triedIds.length - 3}` : "";
    return `Tried Adjacent ids ${shown}${extra}. Title search is last-resort (all-words AND).`;
  }
  return `Could not find this market on Adjacent to load ${subject}.`;
}

function mergeNewsArticles(
  sources: ReadonlyArray<ReadonlyArray<NewsArticle>>,
): NewsArticle[] {
  const seen = new Set<string>();
  const merged: NewsArticle[] = [];
  for (const source of sources) {
    for (const article of source) {
      const key = article.url || article.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(article);
    }
  }
  return merged;
}

function AdjacentMarketTab({
  client,
  lookup,
  subject,
  render,
}: {
  client: AdjacentClient | null;
  lookup: AdjacentMarketLookup;
  subject: string;
  render: (client: AdjacentClient, adjacentMarketId: string) => ReactNode;
}) {
  const match = useAdjacentMarketMatch(client, lookup);

  if (!client) {
    return (
      <Box paddingX={1}>
        <EmptyState
          title="Adjacent not configured."
          hint={`Set an Adjacent API key in settings to enable ${subject}.`}
        />
      </Box>
    );
  }

  if (match.loading) return <Spinner label={`Finding ${subject}...`} />;

  if (match.error) {
    return (
      <Box paddingX={1} flexGrow={1} justifyContent="center">
        <EmptyState
          title="Adjacent lookup failed."
          hint={match.error}
        />
      </Box>
    );
  }

  if (!match.marketId) {
    return (
      <EmptyState
        title="No matching Adjacent market."
        hint={matchHint(match.triedIds, subject)}
      />
    );
  }

  return <>{render(client, match.marketId)}</>;
}

export function PredictionSimilarTab({
  client,
  lookup,
  onSelectAdjacentMarket,
}: {
  client: AdjacentClient | null;
  lookup: AdjacentMarketLookup;
  onSelectAdjacentMarket: (market: AdjacentSimilarMarket) => void;
}) {
  return (
    <AdjacentMarketTab
      client={client}
      lookup={lookup}
      subject="similar markets"
      render={(adjacentClient, adjacentMarketId) => (
        <SimilarMarketsView
          client={adjacentClient}
          marketId={adjacentMarketId}
          onSelectMarket={onSelectAdjacentMarket}
        />
      )}
    />
  );
}

const NEWS_COLUMNS = ["time", "source", "title", "tickers", "categories"] as const;
const NEWS_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

function PredictionNewsStack({
  articles,
  loading,
  error,
  focused,
  width,
  height,
  onRefresh,
  emptyStateTitle,
  emptyStateHint,
  updatedAt,
}: {
  articles: NewsArticle[];
  loading: boolean;
  error: string | null;
  focused: boolean;
  width: number;
  height: number;
  onRefresh?: () => void;
  emptyStateTitle: string;
  emptyStateHint: string;
  updatedAt?: number | null;
}) {
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<NewsSortPreference>(NEWS_SORT);
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
    registrationId: "prediction-markets:news",
    focused,
    article: readableArticle,
    loading,
    error,
    onPopOut: () => popOutArticle(readableArticle),
    onRefresh,
    onShare: shareArticle,
    onRead: readableArticle ? () => markArticleRead(readableArticle.id) : undefined,
    showPoll: !detailArticle,
    updatedAt,
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
    return <Spinner label="Loading news..." />;
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
      columns={[...NEWS_COLUMNS]}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
      onPopOut={() => popOutArticle(readableArticle)}
      onShare={shareArticle}
    />
  );
}

function AdjacentMarketNewsStack({
  client,
  marketId,
  topic,
  focused,
  width,
  height,
}: {
  client: AdjacentClient;
  marketId: string;
  topic?: string | null;
  focused: boolean;
  width: number;
  height: number;
}) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const loadNews = useCallback(() => {
    setLoading(true);
    setError(null);
    const query = topic?.trim() || marketId;
    return Promise.all([
      client.getMarketNews(marketId, { limit: 20 }).catch(() => ({ news: [] })),
      searchRelatedNews(query),
    ])
      .then(([response, related]) => {
        const fromMarket = (response.news ?? []).map(normalizeAdjacentNewsArticle);
        setArticles(mergeNewsArticles([related, fromMarket]));
        setUpdatedAt(Date.now());
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [client, marketId, topic]);

  useEffect(() => {
    setArticles([]);
    void loadNews();
  }, [loadNews]);

  return (
    <PredictionNewsStack
      articles={articles}
      loading={loading}
      error={error}
      focused={focused}
      width={width}
      height={height}
      onRefresh={() => {
        void loadNews();
      }}
      emptyStateTitle="No related news."
      emptyStateHint="No matching headlines for this market."
      updatedAt={updatedAt}
    />
  );
}

function RelatedNewsOnlyStack({
  topic,
  focused,
  width,
  height,
}: {
  topic: string;
  focused: boolean;
  width: number;
  height: number;
}) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const loadNews = useCallback(() => {
    if (!topic.trim()) {
      setArticles([]);
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    setError(null);
    return searchRelatedNews(topic)
      .then((related) => {
        setArticles(related);
        setUpdatedAt(Date.now());
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [topic]);

  useEffect(() => {
    setArticles([]);
    void loadNews();
  }, [loadNews]);

  return (
    <PredictionNewsStack
      articles={articles}
      loading={loading}
      error={error}
      focused={focused}
      width={width}
      height={height}
      onRefresh={() => {
        void loadNews();
      }}
      emptyStateTitle="No related news."
      emptyStateHint="No matching headlines for this market."
      updatedAt={updatedAt}
    />
  );
}

function MergedRelatedNewsStack({
  topic,
  tickerQuery,
  client,
  marketId,
  focused,
  width,
  height,
}: {
  topic: string;
  tickerQuery: NewsQuery;
  client: AdjacentClient | null;
  marketId: string | null;
  focused: boolean;
  width: number;
  height: number;
}) {
  const tickerNews = useNewsArticles(tickerQuery);
  const [related, setRelated] = useState<NewsArticle[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [relatedError, setRelatedError] = useState<string | null>(null);

  const loadRelated = useCallback(() => {
    setRelatedLoading(true);
    setRelatedError(null);
    const marketNews = client && marketId
      ? client.getMarketNews(marketId, { limit: 20 }).catch(() => ({ news: [] }))
      : Promise.resolve({ news: [] as AdjacentNewsArticle[] });
    return Promise.all([searchRelatedNews(topic), marketNews])
      .then(([found, response]) => {
        const fromMarket = (response.news ?? []).map(normalizeAdjacentNewsArticle);
        setRelated(mergeNewsArticles([found, fromMarket]));
        setRelatedLoading(false);
      })
      .catch((err) => {
        setRelatedError(err instanceof Error ? err.message : String(err));
        setRelatedLoading(false);
      });
  }, [client, marketId, topic]);

  useEffect(() => {
    setRelated([]);
    void loadRelated();
  }, [loadRelated]);

  const articles = useMemo(() => {
    return mergeNewsArticles([related, tickerNews.articles]);
  }, [related, tickerNews.articles]);

  const loading = relatedLoading
    || tickerNews.phase === "loading"
    || (tickerNews.phase === "refreshing" && articles.length === 0);
  const error = relatedError ?? (tickerNews.phase === "error" ? tickerNews.error : null);

  return (
    <PredictionNewsStack
      articles={articles}
      loading={loading}
      error={error}
      focused={focused}
      width={width}
      height={height}
      onRefresh={() => {
        void loadRelated();
        void getSharedNewsService()?.load(tickerQuery);
      }}
      emptyStateTitle="No related news."
      emptyStateHint="No matching headlines for this market."
      updatedAt={tickerNews.updatedAt}
    />
  );
}

export function PredictionNewsTab({
  client,
  lookup,
  summary,
  focused,
  width,
  height,
}: {
  client: AdjacentClient | null;
  lookup: AdjacentMarketLookup;
  summary?: Pick<
    PredictionMarketSummary,
    | "venue"
    | "marketId"
    | "title"
    | "marketLabel"
    | "eventLabel"
    | "eventTicker"
    | "seriesTicker"
    | "category"
    | "description"
    | "rulesPrimary"
    | "rulesSecondary"
    | "resolutionSource"
    | "url"
  > | null;
  focused: boolean;
  width: number;
  height: number;
}) {
  const topic = summary?.title
    ?? summary?.marketLabel
    ?? lookup.title
    ?? lookup.marketId
    ?? "";
  const tickerQuery = useMemo(
    () => summary ? buildPredictionNewsQuery(summary) : null,
    [summary],
  );
  const marketId = lookup.marketId
    ? (lookup.marketId.includes(":") ? lookup.marketId : `${lookup.venue ?? "kalshi"}:${lookup.marketId}`)
    : null;

  if (tickerQuery) {
    return (
      <MergedRelatedNewsStack
        topic={topic}
        tickerQuery={tickerQuery}
        client={client}
        marketId={marketId}
        focused={focused}
        width={width}
        height={height}
      />
    );
  }

  if (client && marketId) {
    return (
      <AdjacentMarketNewsStack
        client={client}
        marketId={marketId}
        topic={topic}
        focused={focused}
        width={width}
        height={height}
      />
    );
  }

  return (
    <RelatedNewsOnlyStack
      topic={topic}
      focused={focused}
      width={width}
      height={height}
    />
  );
}
