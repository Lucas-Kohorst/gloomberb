import { useMemo } from "react";
import type { PaneProps, PaneTemplateCreateOptions, PaneTemplateContext } from "../../../types/plugin";
import { composeBuiltinPlugin, type PluginModule } from "../plugin-module";
import { llmStatsModule } from "../llm-stats";
import { owidModule } from "../owid";
import { pollsModule } from "../polls";
import { weatherModule } from "../weather";
import { federalRegisterModule } from "../federal-register";
import { ofacSanctionsModule } from "../ofac-sanctions";
import { usaspendingModule } from "../usaspending";
import {
  AdjacentClient,
  attachAdjacentPersistence,
  getSharedAdjacentClient,
  resolveAdjacentApiKey,
  resetAdjacentPersistence,
  setSharedAdjacentApiKeyResolver,
} from "./client";
import { useAppSelector } from "../../../state/app/context";
import { byokKeysConfigSelector } from "../account-management/ai-providers";
import { AdjacentPane } from "./pane";
import { createAdjacentNewsCapability } from "./news";
import { createAdjacentCatalogSearchProvider, openAdjacentCatalogSearch } from "./command-bar-search";
import { createCftcDocumentSearchProvider } from "./document-search";
import { ADJACENT_CLOUD_CONNECTION_ID } from "../connections/adjacent-cloud";
import { registerConnectionSource } from "../connections/register";
import { registerPluginAgentHarness } from "../../agent-harness";
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
  const [pluginKey] = usePluginConfigState<string>(ADJACENT_API_KEY_CONFIG, "");
  const byokKeys = useAppSelector(byokKeysConfigSelector);
  const apiKey = byokKeys.find((entry) => entry.serviceId === "adjacent")?.apiKey?.trim()
    || pluginKey?.trim()
    || resolveAdjacentApiKey()
    || "";
  const client = useMemo(
    () => getOrCreateClient(apiKey || null),
    [apiKey],
  );
  return client;
}

function AdjacentPaneWrapper(props: PaneProps) {
  const client = useAdjacentClient();
  return <AdjacentPane client={client} {...props} />;
}

const adjacentMarketsModule: PluginModule = {
  panes: [
    {
      id: "adjacent",
      name: "Adjacent",
      icon: "A",
      component: AdjacentPaneWrapper,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 72, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "adjacent-indices-pane",
      paneId: "adjacent",
      label: "Adjacent Indices",
      description: "Browse Adjacent prediction-market indices (RED, BLUE, NTI, house). Chart one with G ADJ:red.",
      keywords: [
        "adjacent",
        "indices",
        "prediction",
        "markets",
        "political",
        "red",
        "blue",
        "nfl",
        "nti",
        "house",
      ],
      category: "Data",
      shortcut: {
        prefix: "ADI",
        argPlaceholder: "ticker or name",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        const query = (options?.arg ?? "").trim();
        return {
          placement: "floating",
          ...(query ? { params: { query }, settings: { defaultTabId: "indices", query }, title: query } : { settings: { defaultTabId: "indices" } }),
        };
      },
    },
    {
      id: "adjacent-rates-pane",
      paneId: "adjacent",
      label: "Adjacent Reference Rates",
      description: "Cross-platform prediction market reference rates with source markets. Chart one with G ADJ:house.",
      keywords: ["adjacent", "rates", "reference", "prediction", "markets", "benchmarks"],
      category: "Data",
      shortcut: {
        prefix: "ADR",
        argPlaceholder: "rate",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        const query = (options?.arg ?? "").trim();
        return {
          placement: "floating",
          ...(query ? { params: { query }, settings: { defaultTabId: "rates", query }, title: query } : { settings: { defaultTabId: "rates" } }),
        };
      },
    },
    {
      id: "adjacent-markets-pane",
      paneId: "adjacent",
      label: "Adjacent Markets",
      description:
        "Search Adjacent prediction-market catalogs as a list (ticker, title, venue, status). Pricing and venue stats stay on PM.",
      keywords: ["adjacent", "markets", "catalog", "kalshi", "polymarket", "search", "list"],
      category: "Data",
      canCreate: () => true,
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        const query = (options?.arg ?? "").trim();
        return {
          placement: "floating",
          ...(query
            ? { params: { query }, settings: { defaultTabId: "markets", query }, title: query }
            : { settings: { defaultTabId: "markets" } }),
        };
      },
    },
    {
      id: "cftc-filings-pane",
      paneId: "adjacent",
      label: "CFTC Filings",
      description:
        "CFTC industry filings: DCM products, DCO registrations, and rule certifications. Search an organization or product, or pass chart to open a stacked DCM-products-by-exchange chart.",
      keywords: [
        "cftc",
        "filings",
        "dcm",
        "dco",
        "products",
        "rules",
        "certification",
        "adjacent",
        "chart",
        "kex",
        "nodal",
      ],
      category: "Data",
      shortcut: {
        prefix: "CFTC",
        argPlaceholder: "organization or product",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        const query = (options?.arg ?? "").trim();
        return {
          placement: "floating",
          ...(query ? { params: { query }, settings: { defaultTabId: "cftc", query }, title: `CFTC ${query.toUpperCase()}` } : { settings: { defaultTabId: "cftc" } }),
        };
      },
    },
  ],

  setup(ctx) {
    attachAdjacentPersistence(ctx.persistence);

    ctx.registerByokService({
      id: "adjacent",
      name: "Adjacent Markets",
      apiUrl: "https://api.adjacent.markets",
      authType: "bearer",
      envVar: "ADJACENT_API_KEY",
      description: "Real-time market data and analytics from Adjacent.",
    });
    setSharedAdjacentApiKeyResolver(() => (
      ctx.getApiKey("adjacent")
      ?? ctx.configState?.get<string>(ADJACENT_API_KEY_CONFIG)
      ?? null
    ));
    adjacentClient = getSharedAdjacentClient();

    ctx.registerCapability?.(createAdjacentNewsCapability(adjacentClient));
    ctx.registerCommandBarSearchProvider(createAdjacentCatalogSearchProvider(ctx));
    ctx.registerDocumentSearchProvider(createCftcDocumentSearchProvider());
    disposeAdjacentConnection = registerConnectionSource({
      id: ADJACENT_CLOUD_CONNECTION_ID,
      name: "Adjacent Cloud",
      kind: "data",
      pluginId: ADJACENT_PLUGIN_ID,
      priority: 200,
      authRequired: false,
    });

    registerPluginAgentHarness(ctx, {
      prompt: [
        "CFTC filings: pane.createFromTemplate cftc-filings-pane (CFTC).",
        "Pass options.arg \"chart\" for a stacked DCM-products-by-exchange bar chart, or an org/product search for the list.",
        "Data: gloomberb_remote {type:\"data\", operation:\"filings.rollup\", feed:\"dcm_products\"}.",
        "Public Adjacent is last 90 days; an Adjacent API key extends the window.",
      ].join(" "),
    });

    ctx.registerCommand({
      id: "adjacent-markets-search",
      label: "Search Adjacent",
      description:
        "Search Adjacent catalogs (markets, indices, rates) and open an Adjacent list. Venue pricing stays on PM.",
      keywords: ["adjacent", "search", "markets", "indices", "rates", "catalog", "kalshi", "polymarket"],
      category: "data",
      shortcut: "ADJ",
      shortcutArg: {
        placeholder: "query",
        kind: "text",
        parse: (arg) => ({ query: arg.trim() }),
      },
      execute: async (values) => {
        const query = (values?.query ?? values?.shortcut ?? "").trim();
        await openAdjacentCatalogSearch(ctx, query);
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
    "Shared reference data cached at the edge: Adjacent indices, rates, CFTC filings, VoteHub polls, weather, llm-stats benchmarks, Our World in Data, Federal Register, OFAC, and USAspending.",
  toggleable: true,
  modules: [
    adjacentMarketsModule,
    pollsModule,
    weatherModule,
    llmStatsModule,
    owidModule,
    federalRegisterModule,
    ofacSanctionsModule,
    usaspendingModule,
  ],
});

export default adjacentPlugin;
