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
import { normalizeAdjacentNewsArticle } from "../../builtin/adjacent/normalize";
import { openNewsArticle } from "../../builtin/news/wire/article-search";
import { usePluginAppActions } from "../../runtime";
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

export function PredictionNewsTab({
  client,
  lookup,
}: {
  client: AdjacentClient | null;
  lookup: AdjacentMarketLookup;
}) {
  const { createPaneFromTemplate } = usePluginAppActions();
  return (
    <AdjacentMarketTab
      client={client}
      lookup={lookup}
      subject="related news"
      render={(adjacentClient, adjacentMarketId) => (
        <AdjacentMarketNewsView
          client={adjacentClient}
          marketId={adjacentMarketId}
          onSelectArticle={(article) => {
            try {
              openNewsArticle(normalizeAdjacentNewsArticle(article), createPaneFromTemplate);
            } catch {
              if (article.url) openUrl(article.url);
            }
          }}
        />
      )}
    />
  );
}
