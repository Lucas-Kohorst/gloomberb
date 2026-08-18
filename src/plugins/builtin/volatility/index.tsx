import type { GloomPlugin } from "../../../types/plugin";
import { attachFredSeriesPersistence } from "../../../data/fred-series";
import { FRED_EXTENDED_SERIES_ENABLED } from "../../../data/fred-extended-series";
import { registerConnectionSource } from "../connections/register";
import { VolatilityPane } from "./pane";

export const VOLATILITY_PLUGIN_ID = "volatility";
export const VOLATILITY_PANE_ID = "volatility";
export const VOLATILITY_CONNECTION_ID = "fred-volatility";

let disposeConnection: (() => void) | null = null;

export const volatilityPlugin: GloomPlugin = {
  id: VOLATILITY_PLUGIN_ID,
  name: "Volatility & Sentiment",
  version: "1.0.0",
  description: "VIX, VXV, VXMT, term structure, and contango/backwardation signals.",
  toggleable: true,

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
    canCreate: () => FRED_EXTENDED_SERIES_ENABLED,
  }],

  setup(ctx) {
    attachFredSeriesPersistence(ctx.persistence);
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
