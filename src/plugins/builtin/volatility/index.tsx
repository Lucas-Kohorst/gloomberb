import type { PluginModule } from "../plugin-module";
import { attachFredSeriesPersistence } from "../../../data/fred-series";
import { registerConnectionSource } from "../connections/register";
import { VolatilityPane } from "./pane";

export const volatilityModule: PluginModule = {
  panes: [{
    id: "volatility",
    name: "Volatility & Sentiment",
    icon: "V",
    component: VolatilityPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 70, height: 22 },
  }],
  paneTemplates: [{
    id: "volatility-pane",
    paneId: "volatility",
    label: "Volatility & Sentiment",
    description: "VIX, VXV, VXMT, term structure, and contango/backwardation signals.",
    keywords: ["vix", "volatility", "vxv", "vxmt", "term structure", "contango", "backwardation", "sentiment", "fear", "greed"],
    shortcut: { prefix: "VIX" },
  }],
  setup(ctx) {
    attachFredSeriesPersistence(ctx.persistence);
    registerConnectionSource({
      id: "fred-volatility",
      name: "FRED Volatility Series",
      kind: "api",
      pluginId: "volatility",
      authRequired: false,
    });
  },
  dispose() {
    // Connection sources are cleaned up when the parent plugin is disabled.
  },
};
