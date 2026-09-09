import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { CashFlowPane } from "./pane";

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

  panes: [
    {
      id: "cash-flow",
      name: "Cash Flow Statement",
      icon: "C",
      component: CashFlowPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "cash-flow-pane",
      paneId: "cash-flow",
      label: "Cash Flow Statement",
      description: "Cash flow statement: operating, investing, and financing cash flows with free cash flow and capital expenditure breakdown.",
      keywords: ["cash", "flow", "cf", "operating", "investing", "financing", "free cash flow", "fcf", "capex"],
      shortcut: "CF",
    }),
  ],
};
