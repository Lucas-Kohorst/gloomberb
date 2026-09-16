import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import type { TickerResearchTabPrefetchContext } from "../../../types/plugin";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { HoldersView } from "./pane";

function prefetchHolders({ ticker, dataProvider }: TickerResearchTabPrefetchContext): void {
  if (!dataProvider?.getHolders) return;
  void dataProvider.getHolders(ticker.metadata.ticker, ticker.metadata.exchange).catch(() => {});
}

export const holdersModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "holders",
      name: "Holders",
      order: 42,
      component: HoldersView,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
      prefetch: prefetchHolders,
    });
  },

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "holders-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Holders",
      description: "Institutional holders for the selected ticker.",
      keywords: ["holders", "ownership", "institutional", "owners", "hds"],
      shortcut: "HDS",
      settings: () => ({ defaultTabId: "holders" }),
    }),
  ],
};
