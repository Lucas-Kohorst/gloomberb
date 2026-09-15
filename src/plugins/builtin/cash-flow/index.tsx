import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { CashFlowPane } from "./pane";
import { buildCashFlowSettingsDef } from "./settings";

export const cashFlowModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "cash-flow",
      name: "Cash Flow",
      order: 35,
      component: CashFlowPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "cash-flow-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Cash Flow Statement",
      description: "Cash flow statement: operating, investing, and financing cash flows with free cash flow and capital expenditure breakdown.",
      keywords: ["cash", "flow", "cf", "operating", "investing", "financing", "free cash flow", "fcf", "capex"],
      shortcut: "CF",
      settings: () => ({ defaultTabId: "cash-flow" }),
    }),
  ],
};
