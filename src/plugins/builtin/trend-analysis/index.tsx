import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
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

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "trend-analysis-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Trend Analysis",
      description: "Trend strength and direction via ADX, Aroon, moving average alignment, and momentum scoring.",
      keywords: ["trend", "trend strength", "adx", "aroon", "moving average", "momentum"],
      shortcut: "TREND",
      settings: () => ({ defaultTabId: "trend-analysis" }),
    }),
  ],
};
