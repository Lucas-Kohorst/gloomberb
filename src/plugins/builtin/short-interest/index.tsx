import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { isUsEquityTicker } from "../../../utils/sec";
import { ShortInterestView } from "./pane";

export const shortInterestModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "short-interest",
      name: "Short Interest",
      order: 36,
      component: ShortInterestView,
      isVisible: ({ ticker }) => isUsEquityTicker(ticker),
    });
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
    }),
  ],
};
