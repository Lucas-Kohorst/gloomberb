import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import {
  attachDividendYieldHealth,
  resetDividendYieldHealth,
  YAHOO_DIVIDENDS_CONNECTION_ID,
} from "./client";
import { dividendYieldHeadless } from "./headless";
import { DividendYieldPane } from "./pane";

let disposeConnection: (() => void) | null = null;

export const dividendYieldModule: PluginModule = {
  setup(ctx) {
    attachDividendYieldHealth(ctx.connectionHealth);
    disposeConnection = ctx.connectionHealth.registerSource({
      id: YAHOO_DIVIDENDS_CONNECTION_ID,
      name: "Yahoo Finance Dividends",
      kind: "api",
      ownerId: "ticker-research",
      detail: "finance.yahoo.com",
      priority: 300,
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
    resetDividendYieldHealth();
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
