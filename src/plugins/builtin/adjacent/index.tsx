import { useCallback, useEffect, useMemo, useState } from "react";
import { Box } from "../../../ui";
import type { PaneProps } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import {
  AdjacentClient,
  attachAdjacentPersistence,
  resetAdjacentPersistence,
  setSharedAdjacentApiKey,
} from "./client";
import { AdjacentIndicesPane } from "./indices";
import { AdjacentRatesPane } from "./rates";
import { createAdjacentNewsCapability } from "./news";
import { usePluginConfigState } from "../../runtime";

const ADJACENT_API_KEY_CONFIG = "adjacentApiKey";

let adjacentClient: AdjacentClient | null = null;

function getOrCreateClient(apiKey: string | null): AdjacentClient {
  if (!adjacentClient) {
    adjacentClient = new AdjacentClient({ apiKey: apiKey ?? undefined });
  } else {
    adjacentClient = new AdjacentClient({ apiKey: apiKey ?? undefined });
  }
  return adjacentClient;
}

/**
 * Hook that reads the Adjacent API key from plugin config state
 * and returns a configured client. Falls back to public endpoints
 * when no key is set.
 */
function useAdjacentClient(): AdjacentClient {
  const [apiKey] = usePluginConfigState<string>(ADJACENT_API_KEY_CONFIG, "");
  const client = useMemo(
    () => getOrCreateClient(apiKey || null),
    [apiKey],
  );
  return client;
}

function AdjacentIndicesPaneWrapper(props: PaneProps) {
  const client = useAdjacentClient();
  return <AdjacentIndicesPane client={client} {...props} />;
}

function AdjacentRatesPaneWrapper(props: PaneProps) {
  const client = useAdjacentClient();
  return <AdjacentRatesPane client={client} {...props} />;
}

export const adjacentModule: PluginModule = {
  panes: [
    {
      id: "adjacent-indices",
      name: "Adjacent Indices",
      icon: "A",
      component: AdjacentIndicesPaneWrapper,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 72, height: 30 },
    },
    {
      id: "adjacent-rates",
      name: "Adjacent Rates",
      icon: "A",
      component: AdjacentRatesPaneWrapper,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 60, height: 24 },
    },
  ],

  paneTemplates: [
    {
      id: "adjacent-indices-pane",
      paneId: "adjacent-indices",
      label: "Adjacent Indices",
      description: "Browse prediction market indices (RED, BLUE, RED-TR) with constituents and charts.",
      keywords: ["adjacent", "indices", "prediction", "markets", "political", "red", "blue"],
      shortcut: { prefix: "ADI" },
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "adjacent-rates-pane",
      paneId: "adjacent-rates",
      label: "Adjacent Reference Rates",
      description: "Cross-platform prediction market reference rates with source markets.",
      keywords: ["adjacent", "rates", "reference", "prediction", "markets", "benchmarks"],
      shortcut: { prefix: "ADR" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup(ctx) {
    attachAdjacentPersistence(ctx.persistence);

    const apiKey = ctx.configState.get<string>(ADJACENT_API_KEY_CONFIG);
    adjacentClient = new AdjacentClient({ apiKey: apiKey ?? undefined });
    setSharedAdjacentApiKey(apiKey ?? null);

    // Register news capability
    ctx.registerCapability(
      createAdjacentNewsCapability(adjacentClient),
    );

    // Commands
    ctx.registerCommand({
      id: "adjacent-indices-open",
      label: "Open Adjacent Indices",
      description: "Browse prediction market indices from Adjacent.",
      keywords: ["adjacent", "indices", "prediction", "markets", "open"],
      category: "navigation",
      execute: async () => {
        ctx.focusPane("adjacent-indices");
      },
    });

    ctx.registerCommand({
      id: "adjacent-rates-open",
      label: "Open Adjacent Rates",
      description: "Browse cross-platform reference rates from Adjacent.",
      keywords: ["adjacent", "rates", "reference", "prediction", "open"],
      category: "navigation",
      execute: async () => {
        ctx.focusPane("adjacent-rates");
      },
    });

    ctx.registerCommand({
      id: "adjacent-markets-search",
      label: "Search Adjacent Markets",
      description: "Search normalized prediction markets via Adjacent.",
      keywords: ["adjacent", "search", "markets", "prediction", "kalshi", "polymarket"],
      category: "data",
      wizard: [
        {
          key: "query",
          label: "Search query",
          placeholder: "e.g. election, fed rate, bitcoin",
          type: "text",
          required: true,
        },
      ],
      execute: async (values) => {
        const query = values?.query?.trim();
        if (!query) {
          ctx.notify({ body: "Enter a search query.", type: "error" });
          return;
        }
        // Focus the prediction markets pane and seed the search
        ctx.resume.setPaneState("prediction-markets:main", "searchQuery", query);
        ctx.resume.setPaneState("prediction-markets:main", "venueScope", "all");
        ctx.resume.setPaneState("prediction-markets:main", "selectedMarketKey", null);
        ctx.focusPane("prediction-markets");
      },
    });
  },

  dispose() {
    resetAdjacentPersistence();
    adjacentClient = null;
  },
};
