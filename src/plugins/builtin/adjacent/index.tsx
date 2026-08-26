import { useMemo } from "react";
import type { PaneProps, PaneTemplateCreateOptions, PaneTemplateContext } from "../../../types/plugin";
import { composeBuiltinPlugin, type PluginModule } from "../plugin-module";
import { pollsModule } from "../polls";
import { llmStatsModule } from "../llm-stats";
import { weatherModule } from "../weather";
import { owidModule } from "../owid";
import {
  AdjacentClient,
  attachAdjacentPersistence,
  resetAdjacentPersistence,
  setSharedAdjacentApiKey,
} from "./client";
import { AdjacentIndicesPane } from "./indices";
import { AdjacentRatesPane } from "./rates";
import { AdjacentFilingsPane, createCftcBrowserInstance } from "./filings";
import { createAdjacentNewsCapability } from "./news";
import { ADJACENT_CLOUD_CONNECTION_ID } from "../connections/adjacent-cloud";
import { registerConnectionSource } from "../connections/register";
import { usePluginConfigState } from "../../runtime";
import { ADJACENT_API_KEY_CONFIG, ADJACENT_PLUGIN_ID } from "./types";

export { ADJACENT_PLUGIN_ID, ADJACENT_API_KEY_CONFIG };

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

function AdjacentFilingsPaneWrapper(props: PaneProps) {
  const client = useAdjacentClient();
  return <AdjacentFilingsPane client={client} {...props} />;
}

const adjacentMarketsModule: PluginModule = {
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
    {
      id: "cftc-filings",
      name: "CFTC Filings",
      icon: "C",
      component: AdjacentFilingsPaneWrapper,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
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
    {
      id: "cftc-filings-pane",
      paneId: "cftc-filings",
      label: "CFTC Filings",
      description:
        "CFTC industry filings: DCM products, DCO registrations, and rule certifications. Search an organization or product, or open CFTC CME to jump there.",
      keywords: [
        "cftc",
        "filings",
        "dcm",
        "dco",
        "products",
        "rules",
        "certification",
        "adjacent",
      ],
      category: "Data",
      shortcut: {
        prefix: "CFTC",
        argPlaceholder: "organization or product",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createCftcBrowserInstance("cftc", "CFTC", options);
      },
    },
  ],

  setup(ctx) {
    attachAdjacentPersistence(ctx.persistence);

    const apiKey = ctx.configState?.get<string>(ADJACENT_API_KEY_CONFIG) ?? null;
    adjacentClient = new AdjacentClient({ apiKey: apiKey ?? undefined });
    setSharedAdjacentApiKey(apiKey ?? null);

    ctx.registerCapability?.(createAdjacentNewsCapability(adjacentClient));
    disposeAdjacentConnection = registerConnectionSource({
      id: ADJACENT_CLOUD_CONNECTION_ID,
      name: "Adjacent Cloud",
      kind: "data",
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

export const adjacentPlugin = composeBuiltinPlugin({
  id: ADJACENT_PLUGIN_ID,
  name: "Adjacent Cloud",
  version: "1.0.0",
  description:
    "Shared reference data cached at the edge: Adjacent indices, rates, and CFTC filings, VoteHub polls, Weather Company / NWS settlements, llm-stats benchmarks, and Our World in Data grapher prints.",
  toggleable: true,
  modules: [adjacentMarketsModule, pollsModule, llmStatsModule, weatherModule, owidModule],
});

export default adjacentPlugin;
