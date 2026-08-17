import type { ReactNode } from "react";
import { Box, Text } from "../../../ui";
import { EmptyState, Spinner } from "../../../components";
import { openUrl } from "../../../components/ui/external-link";
import { colors } from "../../../theme/colors";
import type { AdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentSimilarMarket } from "../../builtin/adjacent/types";
import {
  SimilarMarketsView,
  AdjacentMarketNewsView,
} from "../../builtin/adjacent/prediction-integration";
import { useAdjacentMarketMatch } from "./adjacent-match";

function AdjacentMarketTab({
  client,
  marketTitle,
  subject,
  render,
}: {
  client: AdjacentClient | null;
  marketTitle: string;
  subject: string;
  render: (client: AdjacentClient, adjacentMarketId: string) => ReactNode;
}) {
  const match = useAdjacentMarketMatch(client, marketTitle);

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
      <Box paddingX={1}>
        <Text fg={colors.textDim}>
          Adjacent unavailable: {match.error}
        </Text>
      </Box>
    );
  }

  if (!match.marketId) {
    return (
      <EmptyState
        title="No matching market found."
        hint={`Could not find this market on Adjacent to load ${subject}.`}
      />
    );
  }

  return <>{render(client, match.marketId)}</>;
}

export function PredictionSimilarTab({
  client,
  marketTitle,
  onSelectAdjacentMarket,
}: {
  client: AdjacentClient | null;
  marketTitle: string;
  onSelectAdjacentMarket: (market: AdjacentSimilarMarket) => void;
}) {
  return (
    <AdjacentMarketTab
      client={client}
      marketTitle={marketTitle}
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

export function PredictionNewsTab({
  client,
  marketTitle,
}: {
  client: AdjacentClient | null;
  marketTitle: string;
}) {
  return (
    <AdjacentMarketTab
      client={client}
      marketTitle={marketTitle}
      subject="related news"
      render={(adjacentClient, adjacentMarketId) => (
        <AdjacentMarketNewsView
          client={adjacentClient}
          marketId={adjacentMarketId}
          onSelectArticle={(article) => {
            if (article.url) openUrl(article.url);
          }}
        />
      )}
    />
  );
}
