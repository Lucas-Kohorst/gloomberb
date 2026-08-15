import { useCallback, useEffect, useState } from "react";
import { Box, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { EmptyState, Spinner } from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import type { ChartMouseEvent } from "../../../components/chart/core/pointer";
import type { AdjacentClient } from "./client";
import type { AdjacentSimilarMarket, AdjacentNewsArticle } from "./types";
import { centsToProbability } from "./normalize";

export function SimilarMarketsView({
  client,
  marketId,
  onSelectMarket,
  width,
}: {
  client: AdjacentClient;
  marketId: string;
  onSelectMarket: (market: AdjacentSimilarMarket) => void;
  width: number;
}) {
  const [markets, setMarkets] = useState<AdjacentSimilarMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setMarkets([]);

    client.getSimilarMarkets(marketId)
      .then((response) => {
        setMarkets(response.markets ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [client, marketId]);

  if (loading) {
    return <Spinner label="Loading similar markets..." />;
  }

  if (error) {
    return (
      <Box paddingX={1}>
        <Text fg={colors.textDim}>Similar markets unavailable: {error}</Text>
      </Box>
    );
  }

  if (markets.length === 0) {
    return <EmptyState title="No similar markets found." hint="Adjacent did not return semantically similar markets." />;
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={0}>
      {markets.map((market) => {
        const prob = centsToProbability(market.yes_price);
        return (
          <Box
            key={market.id}
            flexDirection="row"
            height={1}
            gap={2}
            cursor="pointer"
            data-gloom-interactive="true"
            onMouseDown={(event: ChartMouseEvent) => {
              event.preventDefault?.();
              onSelectMarket(market);
            }}
          >
            <Box width={3}>
              <Text fg={colors.textDim}>{market.platform === "kalshi" ? "K" : "P"}</Text>
            </Box>
            <Box width={6}>
              <Text fg={prob != null ? priceColor(prob) : colors.textDim}>
                {prob != null ? `${prob.toFixed(0)}%` : "—"}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text fg={colors.text} wrapMode="ellipsis">{market.title}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function AdjacentMarketNewsView({
  client,
  marketId,
  width,
}: {
  client: AdjacentClient;
  marketId: string;
  width: number;
}) {
  const [articles, setArticles] = useState<AdjacentNewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setArticles([]);

    client.getMarketNews(marketId)
      .then((response) => {
        setArticles(response.news ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [client, marketId]);

  if (loading) {
    return <Spinner label="Loading news..." />;
  }

  if (error) {
    return (
      <Box paddingX={1}>
        <Text fg={colors.textDim}>News unavailable: {error}</Text>
      </Box>
    );
  }

  if (articles.length === 0) {
    return <EmptyState title="No related news." hint="Adjacent did not return news for this market." />;
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      {articles.map((article) => (
        <Box key={article.id} flexDirection="column" height={2}>
          <Text fg={colors.text} wrapMode="ellipsis" attributes={TextAttributes.BOLD}>
            {article.title}
          </Text>
          <Text fg={colors.textDim}>
            {article.source} · {new Date(article.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {article.summary ? ` · ${article.summary.slice(0, 60)}` : ""}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
