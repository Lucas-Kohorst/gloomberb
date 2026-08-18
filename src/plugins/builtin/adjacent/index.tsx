import { useMemo } from "react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import {
  AdjacentClient,
  attachAdjacentPersistence,
  resetAdjacentPersistence,
  setSharedAdjacentApiKey,
} from "./client";
import { AdjacentIndicesPane } from "./indices";
import { AdjacentRatesPane } from "./rates";
import { createAdjacentNewsCapability } from "./news";
import { registerConnectionSource } from "../connections/register";
import { usePluginConfigState } from "../../runtime";

export const ADJACENT_PLUGIN_ID = "adjacent";
const ADJACENT_API_KEY_CONFIG = "adjacentApiKey";

let adjacentClient: AdjacentClient | null = null;
let disposeAdjacentConnection: (() => void) | null = null;

function getOrCreateClient(apiKey: string | null): AdjacentClient {
  const normalizedKey = apiKey ?? null;
  if (!adjacentClient || adjacentClient.apiKey !== normalizedKey) {
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

export const adjacentPlugin: GloomPlugin = {
  id: ADJACENT_PLUGIN_ID,
  name: "Adjacent",
  version: "1.0.0",
  description: "Adjacent prediction-market indices, reference rates, and market search.",
  toggleable: true,

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
      description: "Browse Adjacent prediction-market indices (RED, BLUE, RED-TR). Chart one with G ADJ:red.",
      keywords: ["adjacent", "indices", "prediction", "markets", "political", "red", "blue"],
      category: "Data",
      shortcut: { prefix: "ADI" },
      createInstance: () => ({ placement: "floating" }),
    },
    {
      id: "adjacent-rates-pane",
      paneId: "adjacent-rates",
      label: "Adjacent Reference Rates",
      description: "Cross-platform prediction market reference rates with source markets.",
      keywords: ["adjacent", "rates", "reference", "prediction", "markets", "benchmarks"],
      category: "Data",
      shortcut: { prefix: "ADR" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup(ctx) {
    attachAdjacentPersistence(ctx.persistence);

    const apiKey = ctx.configState?.get<string>(ADJACENT_API_KEY_CONFIG) ?? null;
    adjacentClient = new AdjacentClient({ apiKey: apiKey ?? undefined });
    setSharedAdjacentApiKey(apiKey ?? null);

    // Register news capability (best-effort in partial/test contexts).
    ctx.registerCapability?.(createAdjacentNewsCapability(adjacentClient));
    disposeAdjacentConnection = registerConnectionSource({
      id: "adjacent",
      name: "Adjacent",
      kind: "prediction-market",
      pluginId: ADJACENT_PLUGIN_ID,
      priority: 200,
      authRequired: false,
    });

    ctx.registerCommand({
      id: "adjacent-markets-search",
      label: "Search Adjacent Markets",
      description: "Search normalized prediction markets via Adjacent.",
      keywords: ["adjacent", "search", "markets", "prediction", "kalshi", "polymarket"],
      category: "data",
      shortcut: "ADJ",
      shortcutArg: {
        placeholder: "query",
        kind: "text",
        parse: (arg) => ({ query: arg.trim() }),
      },
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
    disposeAdjacentConnection?.();
    disposeAdjacentConnection = null;
    resetAdjacentPersistence();
    adjacentClient = null;
  },
};
