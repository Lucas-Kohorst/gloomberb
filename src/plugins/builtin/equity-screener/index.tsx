import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { EQUITY_SCREENER_CONNECTION_ID, EQUITY_SCREENER_PLUGIN_ID } from "./client";
import { equityScreenerHeadless } from "./headless";
import { EquityScreenerPane } from "./pane";

let disposeConnection: (() => void) | null = null;

export const equityScreenerModule: PluginModule = {
  setup() {
    disposeConnection?.();
    disposeConnection = registerConnectionSource({
      id: EQUITY_SCREENER_CONNECTION_ID,
      name: "Gloom Cloud Equity Screener",
      kind: "api",
      pluginId: EQUITY_SCREENER_PLUGIN_ID,
      authRequired: true,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },

  panes: [
    {
      id: "equity-screener",
      name: "Equity Screener",
      icon: "S",
      component: EquityScreenerPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 108, height: 30 },
      tableExport: true,
      headless: equityScreenerHeadless,
    },
  ],
  paneTemplates: [
    {
      id: "equity-screener-pane",
      paneId: "equity-screener",
      label: "Equity Screener",
      description:
        "Screen stored equities by valuation, growth, liquidity and reported activity; save criteria to your Cloud account.",
      keywords: [
        "eqs",
        "criteria",
        "screener",
        "valuation",
        "discovery",
        "filter",
      ],
      shortcut: { prefix: "EQS" },
      headless: equityScreenerHeadless,
    },
  ],
};
