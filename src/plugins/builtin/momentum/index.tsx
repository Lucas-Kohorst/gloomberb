import { isEquityResearchTicker } from "../../../tickers/research-visibility";
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

  panes: [
    {
      id: "momentum-sortino",
      name: "Momentum & Sortino",
      icon: "M",
      component: MomentumSortinoPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 28 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "momentum-sortino-pane",
      paneId: "momentum-sortino",
      label: "Momentum & Sortino",
      description: "Momentum, Sortino ratio, annualized volatility, max drawdown, and rate of change.",
      keywords: ["momentum", "sortino", "momo", "volatility", "drawdown", "rate", "change", "risk"],
      shortcut: "MOSO",
    }),
  ],
};
