import { apiClient } from "../../../api-client";
import type { TickerResearchTabLoadContext } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { researchCanReadPro, shownIf } from "../shared/research-tab-availability";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { FILING_EVENTS_PANE_ID, FilingEventsPane } from "./pane";
import { isKnownNonUsListing } from "../../../utils/sec";

function loadFilingEventsTab({ symbol }: TickerResearchTabLoadContext): Promise<boolean> {
  if (!symbol || !researchCanReadPro()) return Promise.resolve(true);
  return shownIf(
    () => apiClient.getFilingEvents(symbol.toUpperCase(), 100),
    (result) => result.events.length > 0,
  );
}

const description =
  "The company's 8-K filings, classified by item and read: agreements, executive changes, auditor changes, restructurings, and what each said.";

export const filingEventsModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "filing-events",
      name: "8-K",
      order: 37,
      component: FilingEventsPane,
      instruments: ["equity"],
      isVisible: ({ ticker }) => !isKnownNonUsListing(ticker),
      load: loadFilingEventsTab,
    });
  },

  panes: [
    {
      id: FILING_EVENTS_PANE_ID,
      name: "8-K Filings",
      icon: "K",
      component: FilingEventsPane,
      defaultPosition: "right",
      tickerFollower: true,
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "filing-events-pane",
      paneId: FILING_EVENTS_PANE_ID,
      label: "8-K Filings",
      description,
      keywords: [
        "8-k",
        "8k",
        "current report",
        "events",
        "material",
        "filings",
        "executive change",
      ],
      shortcut: "EK",
      publicShare: false,
    }),
  ],
};
