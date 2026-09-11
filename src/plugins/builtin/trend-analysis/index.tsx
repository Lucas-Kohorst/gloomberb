import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { TrendAnalysisPane } from "./pane";

export const trendAnalysisModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "trend-analysis",
      name: "Trend",
      order: 43,
      component: TrendAnalysisPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  panes: [
    {
      id: "trend-analysis",
      name: "Trend Analysis",
      icon: "T",
      component: TrendAnalysisPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 28 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "trend-analysis-pane",
      paneId: "trend-analysis",
      label: "Trend Analysis",
      description: "Trend strength and direction via ADX, Aroon, moving average alignment, and momentum scoring.",
      keywords: ["trend", "trend strength", "adx", "aroon", "moving average", "momentum"],
      shortcut: "TREND",
    }),
  ],
};
