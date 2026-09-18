import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { NASDAQ_HALTS_CONNECTION_ID } from "./client";
import { MARKET_HALTS_PANE_ID } from "./model";
import { MarketHaltsPane } from "./pane";

let disposeConnection: (() => void) | null = null;

export const marketHaltsModule: PluginModule = {
  setup() {
    disposeConnection = registerConnectionSource({
      id: NASDAQ_HALTS_CONNECTION_ID,
      name: "Nasdaq Trader",
      kind: "api",
      pluginId: "market-overview",
      priority: 300,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },

  panes: [
    {
      id: MARKET_HALTS_PANE_ID,
      name: "Market Halts",
      icon: "H",
      component: MarketHaltsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 124, height: 26 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "market-halts-pane",
      paneId: MARKET_HALTS_PANE_ID,
      label: "Market Halts",
      description: "Current and recent US trading halts from Nasdaq Trader, with reason and resumption times.",
      keywords: ["halt", "halts", "pause", "luld", "circuit", "breaker", "suspension", "resumption"],
      shortcut: { prefix: "HALT" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
