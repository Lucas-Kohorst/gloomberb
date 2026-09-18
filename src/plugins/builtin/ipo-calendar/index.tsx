import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { STOCKANALYSIS_IPO_CONNECTION_ID } from "./client";
import { attachIpoCalendarPersistence, resetIpoCalendarPersistence } from "./cache";
import { IPOCalendarPane } from "./pane";
import { IPO_CALENDAR_PANE_ID } from "./types";

let disposeConnection: (() => void) | null = null;

export const ipoCalendarModule: PluginModule = {
  setup(ctx) {
    attachIpoCalendarPersistence(ctx.persistence);
    disposeConnection = registerConnectionSource({
      id: STOCKANALYSIS_IPO_CONNECTION_ID,
      name: "Stock Analysis",
      kind: "api",
      pluginId: "macro",
      priority: 300,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    resetIpoCalendarPersistence();
  },

  panes: [
    {
      id: IPO_CALENDAR_PANE_ID,
      name: "IPO Calendar",
      icon: "I",
      component: IPOCalendarPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 28 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "ipo-calendar-pane",
      paneId: IPO_CALENDAR_PANE_ID,
      label: "IPO Calendar",
      description: "Upcoming and recent IPOs from Stock Analysis: pricing, offer size, and first-day return.",
      keywords: [
        "ipo",
        "initial",
        "public",
        "offering",
        "new",
        "listing",
        "debut",
      ],
      shortcut: { prefix: "IPO" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
