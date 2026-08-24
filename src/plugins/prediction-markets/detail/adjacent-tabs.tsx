import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Box } from "../../../ui";
import { EmptyState, Spinner } from "../../../components";
import { useLoadNewsStory } from "../../../news/hooks";
import type { NewsArticle } from "../../../news/types";
import type { AdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentSimilarMarket } from "../../builtin/adjacent/types";
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
import {
  useAdjacentMarketMatch,
  type AdjacentMarketLookup,
} from "./adjacent-match";

function matchHint(triedIds: string[], subject: string): string {
  if (triedIds.length > 0) {
    const shown = triedIds.slice(0, 3).join(", ");
    const extra = triedIds.length > 3 ? ` +${triedIds.length - 3}` : "";
    return `Tried Adjacent ids ${shown}${extra}. Title search is last-resort (all-words AND).`;
  }
  return `Could not find this market on Adjacent to load ${subject}.`;
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

function AdjacentMarketNewsStack({
  client,
  marketId,
  focused,
  width,
  height,
}: {
  client: AdjacentClient;
  marketId: string;
  focused: boolean;
  width: number;
  height: number;
}) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<NewsSortPreference>(NEWS_SORT);

  const loadNews = useCallback(() => {
    setLoading(true);
    setError(null);
    return client.getMarketNews(marketId)
      .then((response) => {
        setArticles((response.news ?? []).map(normalizeAdjacentNewsArticle));
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [client, marketId]);

  useEffect(() => {
    setArticles([]);
    void loadNews();
  }, [loadNews]);

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
    onRefresh: () => {
      void loadNews();
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
      emptyStateTitle="No related news."
      emptyStateHint="Adjacent did not return news for this market."
      onPopOut={() => popOutArticle(readableArticle)}
      onShare={shareArticle}
    />
  );
}

export function PredictionNewsTab({
  client,
  lookup,
  focused,
  width,
  height,
}: {
  client: AdjacentClient | null;
  lookup: AdjacentMarketLookup;
  focused: boolean;
  width: number;
  height: number;
}) {
  return (
    <AdjacentMarketTab
      client={client}
      lookup={lookup}
      subject="related news"
      render={(adjacentClient, adjacentMarketId) => (
        <AdjacentMarketNewsStack
          client={adjacentClient}
          marketId={adjacentMarketId}
          focused={focused}
          width={width}
          height={height}
        />
      )}
    />
  );
}
