import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { PatternRecognitionPane } from "./pane";

export const patternRecognitionModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "pattern-recognition",
      name: "Patterns",
      order: 42,
      component: PatternRecognitionPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  panes: [
    {
      id: "pattern-recognition",
      name: "Pattern Recognition",
      icon: "P",
      component: PatternRecognitionPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 28 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "pattern-recognition-pane",
      paneId: "pattern-recognition",
      label: "Pattern Recognition",
      description: "Detect common chart patterns (double tops/bottoms, head & shoulders, triangles, wedges, flags, channels) from price history.",
      keywords: ["pattern", "pat", "double top", "head shoulders", "triangle", "wedge", "flag", "channel"],
      shortcut: "PAT",
    }),
  ],
};
