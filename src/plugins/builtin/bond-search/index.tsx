import type { PaneTemplateCreateOptions, PaneTemplateContext } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { BondSearchPane } from "./pane";
import { BOND_SEARCH_PANE_ID } from "./model";
import { FRED_CORPORATE_YIELDS_CONNECTION_ID } from "./fred-yields";

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

export const BOND_SEARCH_PLUGIN_ID = "bond-search";

let disposeConnection: (() => void) | null = null;

export const bondSearchModule: PluginModule = {
  panes: [
    {
      id: BOND_SEARCH_PANE_ID,
      name: "Bond Search",
      icon: "B",
      component: BondSearchPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "bond-search-pane",
      paneId: BOND_SEARCH_PANE_ID,
      label: "Bond Search",
      description:
        "Corporate and municipal bond yields, spreads vs. Treasury, and search.",
      keywords: [
        "bond",
        "bonds",
        "corporate",
        "municipal",
        "muni",
        "yield",
        "spread",
        "credit",
        "fixed income",
        "cusip",
        "IG",
        "HY",
      ],
      shortcut: {
        prefix: "BOND",
        argPlaceholder: "issuer, CUSIP, or series",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        const query = queryFromOptions(options);
        return {
          placement: "floating" as const,
          settings: query ? { query, activeTab: "search" } : undefined,
        };
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: FRED_CORPORATE_YIELDS_CONNECTION_ID,
      name: "FRED Corporate Yields",
      kind: "api",
      pluginId: BOND_SEARCH_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};
