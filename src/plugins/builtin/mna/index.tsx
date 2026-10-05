import type { TickerResearchTabLoadContext } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { researchIsPro, shownIf } from "../shared/research-tab-availability";
import { loadMnaDeals, MNA_DEALS_UNAVAILABLE, mnaDealCache, mnaDealsCache } from "./client";
import { mnaHeadless } from "./headless";
import { MNA_PANE_ID } from "./model";
import { MnaPane, MnaTickerTab } from "./pane";

function loadMnaTab({ ticker }: TickerResearchTabLoadContext): Promise<boolean> {
  return shownIf(
    () => loadMnaDeals({ status: "all", symbol: ticker.metadata.ticker }, researchIsPro()),
    (resource) => resource.payload.deals.length > 0,
    (error) => error instanceof Error && error.message === MNA_DEALS_UNAVAILABLE,
  );
}

export const mnaModule: PluginModule = {
  setup(ctx) {
    mnaDealsCache.attach(ctx.persistence);
    mnaDealCache.attach(ctx.persistence);
    ctx.registerTickerResearchTab({
      id: "mna",
      name: "M&A",
      order: 36,
      component: MnaTickerTab,
      instruments: ["equity"],
      load: loadMnaTab,
    });
  },

  dispose() {
    mnaDealsCache.reset();
    mnaDealCache.reset();
  },

  panes: [
    {
      id: MNA_PANE_ID,
      name: "M&A",
      icon: "M",
      component: MnaPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 120, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "mna-pane",
      paneId: MNA_PANE_ID,
      label: "M&A",
      description: "Pending, rumored and closed mergers and acquisitions, with live arbitrage spreads on listed targets.",
      keywords: ["m&a", "mna", "merger", "mergers", "acquisition", "acquisitions", "takeover", "tender offer", "deal", "arbitrage", "spread"],
      shortcut: { prefix: "MA", argPlaceholder: "ticker", argKind: "ticker", argOptional: true },
      headless: mnaHeadless,
      createInstance: (_context, options) => {
        const symbol = (options?.symbol ?? options?.arg)?.trim().toUpperCase();
        return symbol
          ? { instanceId: `${MNA_PANE_ID}:${symbol}`, title: `M&A ${symbol}`, placement: "floating", settings: { ticker: symbol } }
          : { placement: "floating" };
      },
    },
  ],
};
