import { isEquityResearchTicker } from "../../../tickers/research-visibility";
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

  panes: [
    {
      id: "assets-under-management",
      name: "Assets Under Management",
      icon: "A",
      component: AumPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 20 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "assets-under-management-pane",
      paneId: "assets-under-management",
      label: "Assets Under Management",
      description: "Market cap, shares outstanding, fund size, and AUM metrics.",
      keywords: ["aum", "assets", "under", "management", "market cap", "fund size", "shares"],
      shortcut: "AUM",
    }),
  ],
};
