import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { isUsEquityTicker } from "../../../utils/sec";
import { ShortInterestView } from "./pane";

let disposeShortInterestConnection: (() => void) | null = null;

export const shortInterestModule: PluginModule = {
  setup(ctx) {
    disposeShortInterestConnection = registerConnectionSource({
      id: "yahoo-short-interest",
      name: "Yahoo Finance Short Interest",
      kind: "api",
      pluginId: "short-interest",
      authRequired: false,
    });

    ctx.registerTickerResearchTab({
      id: "short-interest",
      name: "Short Interest",
      order: 36,
      component: ShortInterestView,
      isVisible: ({ ticker }) => isUsEquityTicker(ticker),
    });
  },

  dispose() {
    disposeShortInterestConnection?.();
    disposeShortInterestConnection = null;
  },

  panes: [
    {
      id: "short-interest",
      name: "Short Interest",
      icon: "S",
      component: ShortInterestView,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 25 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "short-interest-pane",
      paneId: "short-interest",
      label: "Short Interest",
      description: "Historical short interest, days to cover, and short % of float.",
      keywords: ["short", "interest", "si", "shorts", "borrow", "days", "cover"],
      shortcut: "SI",
      canCreate: (_context, options) => !options?.ticker || isUsEquityTicker(options.ticker),
    }),
  ],
};
