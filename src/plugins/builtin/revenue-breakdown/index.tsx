import type { TickerResearchTabLoadContext } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { researchIsPro, shownIf } from "../shared/research-tab-availability";
import { listingIdentity } from "../shared/ticker-request";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { isKnownNonUsListing } from "../../../utils/sec";
import { loadRevenueBreakdown, NO_BREAKDOWN, revenueBreakdownCache } from "./client";
import { revenueBreakdownHeadless } from "./headless";
import {
  REVENUE_BREAKDOWN_PANE_ID,
  RevenueBreakdownPane,
  RevenueResearchTab,
} from "./pane";

function loadRevenueTab({ symbol, exchange }: TickerResearchTabLoadContext): Promise<boolean> {
  const identity = listingIdentity(symbol, exchange);
  if (!identity) return Promise.resolve(true);
  return shownIf(
    () => loadRevenueBreakdown(identity.symbol, "product", researchIsPro()),
    (resource) => resource.payload.periods.length > 0 || resource.payload.rows.length > 0 || resource.payload.lockedRows > 0,
    (error) => error instanceof Error && error.message === NO_BREAKDOWN,
  );
}

export const revenueBreakdownModule: PluginModule = {
  setup(ctx) {
    revenueBreakdownCache.attach(ctx.persistence);
    ctx.registerTickerResearchTab({
      id: "revenue",
      name: "Revenue",
      order: 22,
      component: RevenueResearchTab,
      instruments: ["equity"],
      isVisible: ({ ticker }) => !isKnownNonUsListing(ticker),
      load: loadRevenueTab,
    });
  },

  dispose() {
    revenueBreakdownCache.reset();
  },

  panes: [
    {
      id: REVENUE_BREAKDOWN_PANE_ID,
      name: "Revenue Breakdown",
      icon: "R",
      component: RevenueBreakdownPane,
      defaultPosition: "right",
      tickerFollower: true,
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 16 },
      tableExport: true,
      headless: revenueBreakdownHeadless,
    },
  ],

  paneTemplates: [
    {
      ...createTickerSurfacePaneTemplate({
        id: "revenue-breakdown-seg",
        paneId: REVENUE_BREAKDOWN_PANE_ID,
        label: "Revenue Breakdown",
        description:
          "Quarterly revenue by product, segment or region from the company's 10-Q and 10-K filings.",
        shortcut: "SEG",
        keywords: ["revenue", "segments", "segment", "products", "product", "geography", "regions", "seg"],
        settings: () => ({ view: "product" }),
      }),
      headless: revenueBreakdownHeadless,
    },
  ],
};
