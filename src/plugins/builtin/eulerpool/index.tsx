import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { registerConnectionSource } from "../connections/register";
import { EulerpoolPane, EulerpoolResearchTab } from "./pane";
import { setEulerpoolApiKeyResolver } from "./client";
import {
  EULERPOOL_API_BASE_URL,
  EULERPOOL_BYOK_SERVICE_ID,
  EULERPOOL_CONNECTION_ID,
  EULERPOOL_PANE_ID,
  EULERPOOL_PLUGIN_ID,
} from "./types";

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createEulerpoolInstance(options?: PaneTemplateCreateOptions) {
  const query = queryFromOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `${EULERPOOL_PANE_ID}:${encoded}` : `${EULERPOOL_PANE_ID}:latest`,
    title: query ? `Eulerpool ${query.toUpperCase()}` : "Eulerpool",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;

export const eulerpoolPlugin: GloomPlugin = {
  id: EULERPOOL_PLUGIN_ID,
  name: "Eulerpool",
  version: "0.1.0",
  description:
    "Company profile plus annual income and cash-flow statements from Eulerpool. Quotes stay on Yahoo.",
  toggleable: true,

  panes: [
    {
      id: EULERPOOL_PANE_ID,
      name: "Eulerpool",
      icon: "E",
      component: EulerpoolPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "eulerpool-pane",
      paneId: EULERPOOL_PANE_ID,
      label: "Eulerpool Fundamentals",
      description:
        "Annual income and cash-flow statements plus company profile from Eulerpool. Search a ticker or ISIN.",
      keywords: [
        "eulerpool",
        "fundamentals",
        "income statement",
        "cash flow",
        "financials",
        "statements",
        "ratios",
        "ebit",
        "revenue",
      ],
      category: "Data",
      shortcut: {
        prefix: "EUL",
        argPlaceholder: "ticker or ISIN",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createEulerpoolInstance(options);
      },
    },
  ],

  setup(ctx: GloomPluginContext) {
    ctx.registerByokService({
      id: EULERPOOL_BYOK_SERVICE_ID,
      name: "Eulerpool",
      apiUrl: EULERPOOL_API_BASE_URL,
      authType: "bearer",
      envVar: "EULERPOOL_API_KEY",
      description:
        "Token from eulerpool.com/developers/register. Free tier is delayed fundamentals; anonymous calls 401.",
    });
    setEulerpoolApiKeyResolver(() => ctx.getApiKey(EULERPOOL_BYOK_SERVICE_ID));
    disposeConnection = registerConnectionSource({
      id: EULERPOOL_CONNECTION_ID,
      name: "Eulerpool",
      kind: "api",
      pluginId: EULERPOOL_PLUGIN_ID,
      authRequired: true,
    });
    ctx.registerTickerResearchTab({
      id: "eulerpool",
      name: "Eulerpool",
      order: 48,
      component: EulerpoolResearchTab,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
    ctx.registerAgentPromptFragment(
      "Eulerpool (EUL) loads company profile, annual income statements, and cash flow for a ticker or ISIN. It is not a quote source.",
    );
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default eulerpoolPlugin;
