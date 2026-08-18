import type { GloomPlugin } from "../../../types/plugin";
import { attachFredSeriesPersistence } from "../../../data/fred-series";
import { FRED_EXTENDED_SERIES_ENABLED } from "../../../data/fred-extended-series";
import { registerConnectionSource } from "../connections/register";
import { BondSearchPane } from "./pane";
import { BOND_SEARCH_PANE_ID } from "./model";
import { FRED_CORPORATE_YIELDS_CONNECTION_ID } from "./fred-yields";

export const BOND_SEARCH_PLUGIN_ID = "bond-search";

let disposeConnection: (() => void) | null = null;

export const bondSearchPlugin: GloomPlugin = {
  id: BOND_SEARCH_PLUGIN_ID,
  name: "Bond Search",
  version: "1.0.0",
  description: "Corporate and municipal bond yields, spreads vs. Treasury, and search.",
  toggleable: true,

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
      shortcut: { prefix: "BOND" },
      canCreate: () => FRED_EXTENDED_SERIES_ENABLED,
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup(ctx) {
    // Share the FRED series cache/persistence namespace used by the econ plugin.
    attachFredSeriesPersistence(ctx.persistence);
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
