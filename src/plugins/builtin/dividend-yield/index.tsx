import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { registerConnectionSource } from "../connections/register";
import { YAHOO_DIVIDENDS_CONNECTION_ID } from "./client";
import { dividendYieldHeadless } from "./headless";
import { DividendYieldPane } from "./pane";

let disposeConnection: (() => void) | null = null;

export const dividendYieldModule: PluginModule = {
  setup(ctx) {
    // Folded onto the Yahoo origin; this call no-ops in the inventory.
    disposeConnection = registerConnectionSource({
      id: YAHOO_DIVIDENDS_CONNECTION_ID,
      name: "Yahoo Finance Dividends",
      kind: "api",
      pluginId: "ticker-research",
      authRequired: false,
    });

    ctx.registerTickerResearchTab({
      id: "dividend-yield",
      name: "Dividends",
      order: 38,
      component: DividendYieldPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },

  paneTemplates: [
    {
      ...createTickerSurfacePaneTemplate({
        id: "dividend-yield-pane",
        paneId: TICKER_RESEARCH_PANE_ID,
        label: "Dividend Yield",
        description: "Dividend history, trailing/forward yield, growth rates, and payment schedule.",
        keywords: ["dividend", "yield", "dvd", "income", "payout", "ex-date", "distribution"],
        shortcut: "DVD",
        settings: () => ({ defaultTabId: "dividend-yield" }),
      }),
      headless: dividendYieldHeadless,
    },
  ],
};
