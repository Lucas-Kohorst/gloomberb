import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { EsgPane } from "./pane";

export const esgModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "esg",
      name: "ESG",
      order: 39,
      component: EsgPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "esg-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "ESG & Climate",
      description: "ESG scores, carbon emissions, climate risk, and peer/sector comparison.",
      keywords: ["esg", "climate", "carbon", "sustainability", "emissions", "controversy"],
      shortcut: "ESG",
      settings: () => ({ defaultTabId: "esg" }),
    }),
  ],
};
