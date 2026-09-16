import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { AumPane } from "./pane";

export const assetsUnderManagementModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "assets-under-management",
      name: "AUM",
      order: 39,
      component: AumPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "assets-under-management-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Assets Under Management",
      description: "Market cap, shares outstanding, fund size, and AUM metrics.",
      keywords: ["aum", "assets", "under", "management", "market cap", "fund size", "shares"],
      shortcut: "AUM",
      settings: () => ({ defaultTabId: "assets-under-management" }),
    }),
  ],
};
