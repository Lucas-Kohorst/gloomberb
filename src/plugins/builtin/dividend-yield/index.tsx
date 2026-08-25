import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { DividendYieldPane } from "./pane";

export const dividendYieldModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "dividend-yield",
      name: "Dividends",
      order: 38,
      component: DividendYieldPane,
      isVisible: ({ ticker }) => !!ticker,
    });
  },

  panes: [
    {
      id: "dividend-yield",
      name: "Dividend Yield",
      icon: "D",
      component: DividendYieldPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 28 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "dividend-yield-pane",
      paneId: "dividend-yield",
      label: "Dividend Yield",
      description: "Dividend history, trailing/forward yield, growth rates, and payment schedule.",
      keywords: ["dividend", "yield", "dvd", "income", "payout", "ex-date", "distribution"],
      shortcut: "DVD",
    }),
  ],
};
