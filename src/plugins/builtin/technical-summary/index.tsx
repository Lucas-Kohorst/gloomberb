import { isEquityResearchTicker } from "../../../tickers/research-visibility";
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

  panes: [
    {
      id: "technical-summary",
      name: "Technical Summary",
      icon: "T",
      component: TechnicalSummaryPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 28 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "technical-summary-pane",
      paneId: "technical-summary",
      label: "Technical Summary",
      description: "RSI, MACD, Bollinger Bands, Stochastic, ADX, and volume analysis.",
      keywords: ["technical", "tas", "rsi", "macd", "bollinger", "stochastic", "adx", "indicators"],
      shortcut: "TAS",
    }),
  ],
};
