import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { TechnicalSummaryPane } from "./pane";

export const technicalSummaryModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "technical-summary",
      name: "Technical",
      order: 44,
      component: TechnicalSummaryPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "technical-summary-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Technical Summary",
      description: "RSI, MACD, Bollinger Bands, Stochastic, ADX, and volume analysis.",
      keywords: ["technical", "tas", "rsi", "macd", "bollinger", "stochastic", "adx", "indicators"],
      shortcut: "TAS",
      settings: () => ({ defaultTabId: "technical-summary" }),
    }),
  ],
};
