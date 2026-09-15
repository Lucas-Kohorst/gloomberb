import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { MomentumSortinoPane } from "./pane";

export const momentumSortinoModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "momentum-sortino",
      name: "Momentum",
      order: 45,
      component: MomentumSortinoPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "momentum-sortino-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Momentum & Sortino",
      description: "Momentum, Sortino ratio, annualized volatility, max drawdown, and rate of change.",
      keywords: ["momentum", "sortino", "momo", "volatility", "drawdown", "rate", "change", "risk"],
      shortcut: "MOSO",
      settings: () => ({ defaultTabId: "momentum-sortino" }),
    }),
  ],
};
