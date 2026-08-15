import { useEffect, useState } from "react";
import { Box, Text } from "../../../ui";
import { EmptyState, Spinner } from "../../../components";
import { colors } from "../../../theme/colors";
import type { AdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentSimilarMarket } from "../../builtin/adjacent/types";
import {
  SimilarMarketsView,
  AdjacentMarketNewsView,
} from "../../builtin/adjacent/prediction-integration";

export function PredictionSimilarTab({
  client,
  marketTitle,
  onSelectAdjacentMarket,
  width,
}: {
  client: AdjacentClient | null;
  marketTitle: string;
  onSelectAdjacentMarket: (market: AdjacentSimilarMarket) => void;
  width: number;
}) {
  const [adjacentId, setAdjacentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !marketTitle) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setAdjacentId(null);

    // Search Adjacent for a matching market by title
    client.searchMarkets(marketTitle, 5)
      .then((response) => {
        const match = (response.markets ?? []).find(
          (m) => m.title.toLowerCase().includes(marketTitle.toLowerCase().slice(0, 20)) ||
                 marketTitle.toLowerCase().includes(m.title.toLowerCase().slice(0, 20)),
        );
        setAdjacentId(match?.id ?? response.markets?.[0]?.id ?? null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [client, marketTitle]);

  if (!client) {
    return (
      <Box paddingX={1}>
        <EmptyState
          title="Adjacent not configured."
          hint="Set an Adjacent API key in settings to enable similar markets."
        />
      </Box>
    );
  }

  if (loading) {
    return <Spinner label="Finding similar markets..." />;
  }

  if (error) {
    return (
      <Box paddingX={1}>
        <Text fg={colors.textDim}>Similar markets unavailable: {error}</Text>
      </Box>
    );
  }

  if (!adjacentId) {
    return (
      <EmptyState
        title="No matching market found."
        hint="Could not find this market on Adjacent to find similar markets."
      />
    );
  }

  return (
    <SimilarMarketsView
      client={client}
      marketId={adjacentId}
      onSelectMarket={onSelectAdjacentMarket}
      width={width}
    />
  );
}

export function PredictionNewsTab({
  client,
  marketTitle,
  width,
}: {
  client: AdjacentClient | null;
  marketTitle: string;
  width: number;
}) {
  const [adjacentId, setAdjacentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !marketTitle) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setAdjacentId(null);

    client.searchMarkets(marketTitle, 5)
      .then((response) => {
        const match = (response.markets ?? []).find(
          (m) => m.title.toLowerCase().includes(marketTitle.toLowerCase().slice(0, 20)) ||
                 marketTitle.toLowerCase().includes(m.title.toLowerCase().slice(0, 20)),
        );
        setAdjacentId(match?.id ?? response.markets?.[0]?.id ?? null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [client, marketTitle]);

  if (!client) {
    return (
      <Box paddingX={1}>
        <EmptyState
          title="Adjacent not configured."
          hint="Set an Adjacent API key in settings to enable related news."
        />
      </Box>
    );
  }

  if (loading) {
    return <Spinner label="Finding related news..." />;
  }

  if (error) {
    return (
      <Box paddingX={1}>
        <Text fg={colors.textDim}>News unavailable: {error}</Text>
      </Box>
    );
  }

  if (!adjacentId) {
    return (
      <EmptyState
        title="No matching market found."
        hint="Could not find this market on Adjacent to fetch related news."
      />
    );
  }

  return (
    <AdjacentMarketNewsView
      client={client}
      marketId={adjacentId}
      width={width}
    />
  );
}
