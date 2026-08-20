import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { VolatilityPane } from "./pane";

export const VOLATILITY_PLUGIN_ID = "volatility";
export const VOLATILITY_PANE_ID = "volatility";
export const VOLATILITY_CONNECTION_ID = "fred-volatility";

let disposeConnection: (() => void) | null = null;

export const volatilityModule: PluginModule = {
  panes: [{
    id: VOLATILITY_PANE_ID,
    name: "Volatility & Sentiment",
    icon: "V",
    component: VolatilityPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 70, height: 22 },
  }],

  paneTemplates: [{
    id: "volatility-pane",
    paneId: VOLATILITY_PANE_ID,
    label: "Volatility & Sentiment",
    description: "VIX, VXV, VXMT, term structure, and contango/backwardation signals.",
    keywords: ["vix", "volatility", "vxv", "vxmt", "term structure", "contango", "backwardation", "sentiment", "fear", "greed"],
    shortcut: { prefix: "VIX" },
  }],

  setup() {
    disposeConnection = registerConnectionSource({
      id: VOLATILITY_CONNECTION_ID,
      name: "FRED Volatility Series",
      kind: "api",
      pluginId: VOLATILITY_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};
