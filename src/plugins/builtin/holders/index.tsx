import type { TickerResearchTabLoadContext } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { shownIf } from "../shared/research-tab-availability";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { loadHolderData } from "./client";
import { holdersHeadless } from "./headless";
import { HoldersView } from "./pane";

function loadHoldersTab({ symbol, exchange, marketData }: TickerResearchTabLoadContext): Promise<boolean> {
  if (!symbol || !marketData) return Promise.resolve(true);
  return shownIf(
    () => loadHolderData(marketData, symbol, exchange),
    (data) => data.holders.length > 0,
  );
}


export const holdersModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "holders",
      name: "Holders",
      order: 42,
      component: HoldersView,
      instruments: ["equity"],
      load: loadHoldersTab,
    });
  },

  panes: [
    {
      id: "holders",
      name: "Holders",
      icon: "H",
      component: HoldersView,
      defaultPosition: "right",
      tickerFollower: true,
      defaultMode: "floating",
      defaultFloatingSize: { width: 105, height: 34 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      ...createTickerSurfacePaneTemplate({
        id: "holders-pane",
        paneId: "holders",
        label: "Holders",
        description: "Institutional holders for the selected ticker.",
        keywords: ["holders", "ownership", "institutional", "owners", "hds"],
        shortcut: "HDS",
      }),
      headless: holdersHeadless,
    },
  ],
};
