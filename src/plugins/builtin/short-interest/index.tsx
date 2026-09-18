import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { registerConnectionSource } from "../connections/register";
import { YAHOO_SHORT_INTEREST_CONNECTION_ID } from "./client";
import { ShortInterestView } from "./pane";

let disposeConnection: (() => void) | null = null;

export const shortInterestModule: PluginModule = {
  setup(ctx) {
    // Folded onto the Yahoo origin; this call no-ops in the inventory.
    disposeConnection = registerConnectionSource({
      id: YAHOO_SHORT_INTEREST_CONNECTION_ID,
      name: "Yahoo Finance Short Interest",
      kind: "api",
      pluginId: "ticker-research",
      authRequired: false,
    });

    ctx.registerTickerResearchTab({
      id: "short-interest",
      name: "Short Interest",
      order: 36,
      component: ShortInterestView,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "short-interest-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Short Interest",
      // Yahoo's key-statistics module only carries the current and prior settlement dates.
      description: "Bi-monthly short interest settlements from FINRA with days to cover and average daily volume.",
      keywords: ["short", "interest", "si", "shorts", "borrow", "days", "cover"],
      shortcut: "SI",
      settings: () => ({ defaultTabId: "short-interest" }),
    }),
  ],
};
